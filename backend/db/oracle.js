/* ==========================================================
   CONEXIÓN A ORACLE
   Usa node-oracledb en modo "thin" (no requiere Oracle Client).
   Expone una interfaz pequeña que usan los servicios:

     db.ejecutar(sql, binds)      → una sentencia (con commit)
     db.sesion(async (s) => ...)  → varias sentencias en una misma
                                    conexión; hace commit al terminar
                                    y rollback si hay error
   ========================================================== */

import oracledb from 'oracledb';
import { config } from '../config/env.js';


oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT; // filas como objetos: { ID_PRODUCTO: 1, ... }

const IDENTIFICADOR_SQL = /^[A-Za-z][A-Za-z0-9_$#]{0,29}$/;

let pool = null;


/* ---------- Pool de conexiones ---------- */

export async function iniciarPool() {
  const { usuario, clave, conexion, carteraDir, carteraClave, esquema } = config.oracle;

  if (esquema && !IDENTIFICADOR_SQL.test(esquema)) {
    throw new Error('ORACLE_SCHEMA no es un nombre de esquema válido.');
  }

  pool = await oracledb.createPool({
    user: usuario,
    password: clave,
    connectString: conexion,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
    ...(carteraDir ? { configDir: carteraDir, walletLocation: carteraDir, walletPassword: carteraClave } : {})
  });
}

export async function cerrarPool() {
  if (pool) await pool.close(10);
  pool = null;
}

async function obtenerConexion() {
  if (!pool) throw new Error('El pool de Oracle no está iniciado.');

  const conexion = await pool.getConnection();

  // Si la app se conecta con otro usuario y las tablas están en otro esquema (ej: ADMIN)
  if (config.oracle.esquema) {
    await conexion.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${config.oracle.esquema}`);
  }

  return conexion;
}


/* ---------- Sesión: varias sentencias en una transacción ---------- */

function envolver(conexion) {
  const esquemaTipos = (config.oracle.esquema || config.oracle.usuario).toUpperCase();

  return {
    // Siempre con binds (:nombre). Nunca se concatenan datos del usuario en el SQL.
    ejecutar: (sql, binds = {}, opciones = {}) => conexion.execute(sql, binds, { autoCommit: false, ...opciones }),

    commit: () => conexion.commit(),
    rollback: () => conexion.rollback(),

    // Bind de salida numérico (para RETURNING ... INTO y parámetros OUT)
    salidaNumero: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },

    // Crea un bind para un tipo colección de Oracle (ej: T_LISTA_ITEMS)
    async listaDe(nombreTipo, filas) {
      const Clase = await conexion.getDbObjectClass(`${esquemaTipos}.${nombreTipo}`);
      return { dir: oracledb.BIND_IN, type: Clase, val: new Clase(filas) };
    }
  };
}

export async function sesion(funcion) {
  const conexion = await obtenerConexion();

  try {
    const resultado = await funcion(envolver(conexion));
    await conexion.commit();
    return resultado;
  } catch (error) {
    try { await conexion.rollback(); } catch { /* la conexión ya falló */ }
    throw error;
  } finally {
    await conexion.close();
  }
}

export function ejecutar(sql, binds = {}) {
  return sesion((s) => s.ejecutar(sql, binds));
}


export const db = {
  ejecutar,
  sesion,
  salidaNumero: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
};
