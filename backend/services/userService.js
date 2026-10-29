/* ==========================================================
   USUARIOS (registro por roles)
   USUARIO guarda los datos; la tabla ADMINISTRADOR, CAJERO o
   COCINERO (según el rol) referencia al usuario.
   ========================================================== */

import { ErrorApp, primerValor } from './errores.js';
import { hashearClave } from './authService.js';


// SQL fijo por rol: el nombre de la tabla nunca viene del usuario
const INSERTAR_ROL = {
  administrador: '/* usuario_rol_administrador */ INSERT INTO administrador (id_usuario) VALUES (:id)',
  cajero: '/* usuario_rol_cajero */ INSERT INTO cajero (id_usuario) VALUES (:id)',
  cocinero: '/* usuario_rol_cocinero */ INSERT INTO cocinero (id_usuario) VALUES (:id)'
};


export async function crearUsuario(db, { nombre, usuario, password, rol }) {
  return db.sesion(async (s) => {
    const existe = await s.ejecutar(
      `/* usuario_existe */ SELECT id_usuario FROM usuario WHERE LOWER(nombre_usuario) = LOWER(:usuario)`, { usuario });

    if (existe.rows.length) throw new ErrorApp(409, 'Ese nombre de usuario ya está registrado.');

    const resultado = await s.ejecutar(`
      /* usuario_crear */
      INSERT INTO usuario (nombre, nombre_usuario, contrasena_hash)
      VALUES (:nombre, :usuario, :hash)
      RETURNING id_usuario INTO :id`,
      { nombre, usuario, hash: hashearClave(password), id: s.salidaNumero });

    const id = primerValor(resultado.outBinds.id);

    await s.ejecutar(INSERTAR_ROL[rol], { id });

    return { id, nombre, usuario, rol };
  });
}


export async function listarUsuarios(db) {
  const { rows } = await db.ejecutar(`
    /* usuarios_listar */
    SELECT u.id_usuario, u.nombre, u.nombre_usuario, u.activo,
           CASE WHEN a.id_usuario IS NOT NULL THEN 'administrador'
                WHEN c.id_usuario IS NOT NULL THEN 'cajero'
                WHEN k.id_usuario IS NOT NULL THEN 'cocinero'
           END AS rol
      FROM usuario u
      LEFT JOIN administrador a ON a.id_usuario = u.id_usuario
      LEFT JOIN cajero        c ON c.id_usuario = u.id_usuario
      LEFT JOIN cocinero      k ON k.id_usuario = u.id_usuario
     ORDER BY u.id_usuario`);

  return rows.map((r) => ({
    id: r.ID_USUARIO, nombre: r.NOMBRE, usuario: r.NOMBRE_USUARIO, activo: r.ACTIVO === 1, rol: r.ROL
  }));
}
