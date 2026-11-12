/* ==========================================================
   RESPALDO Y RESTAURACIÓN (BACKUP / RESTORE)
   Sprint 4 · #30 Módulo de respaldo automático

   Respaldo LÓGICO: guarda el contenido de las tablas en un
   archivo JSON (backend/respaldos/respaldo-AAAAMMDD-HHMMSS.json)
   con una huella SHA-256 para detectar archivos dañados.

   · Se hace solo cada RESPALDO_CADA_HORAS (24 por defecto) y
     a pedido del administrador (API) o por terminal.
   · Se conservan los últimos RESPALDO_MAX respaldos.
   · Restaurar reemplaza las tablas del negocio en UNA sola
     transacción: si algo falla, Oracle deshace todo y los
     datos quedan como estaban. Antes de restaurar siempre se
     guarda un respaldo de seguridad ("seguridad-...json").
   · AUDITORIA y FEEDBACK se respaldan, pero NUNCA se pisan al
     restaurar (el historial no debe retroceder en el tiempo).

   Límites: no soporta columnas BLOB/RAW. No reemplaza el
   respaldo físico de Oracle (RMAN / respaldos de Autonomous).
   ========================================================== */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { ErrorApp } from './errores.js';
import { logger } from './logger.js';
import { registrarAuditoria } from './auditService.js';
import { alertarRespaldoFallido } from './alertasService.js';


// Las que se reemplazan al restaurar (mismas tablas que npm run probar-conexion)
export const TABLAS_NEGOCIO = [
  'USUARIO', 'ADMINISTRADOR', 'CAJERO', 'COCINERO', 'CLIENTE', 'PRODUCTO', 'PEDIDO', 'DETALLE_PEDIDO', 'VENTA', 'REPORTE',
  'CLIENTE_PERFIL', 'DIRECCION_DESPACHO', 'PAGO'      // tareas 32 y 33
];

// Se respaldan, pero la restauración no las toca
export const TABLAS_REGISTRO = ['AUDITORIA', 'FEEDBACK'];

const FORMATO = 'bajon-respaldo';
const VERSION = 1;
const CONSERVAR_SEGURIDAD = 3;

const IDENTIFICADOR = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const NOMBRE_ARCHIVO = /^(respaldo|seguridad)-\d{8}-\d{6}(-\d+)?\.json$/;
const TIPO_SOPORTADO = /^(VARCHAR2|NVARCHAR2|CHAR|NCHAR|NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|DATE|TIMESTAMP.*|CLOB|NCLOB)$/;
const esFecha = (tipo) => /^(DATE|TIMESTAMP)/.test(tipo);
const esTextoLargo = (tipo) => tipo === 'CLOB' || tipo === 'NCLOB';

const esquemaActual = () => (config.oracle.esquema || config.oracle.usuario || '').toUpperCase();
const huella = (tablas) => createHash('sha256').update(JSON.stringify(tablas)).digest('hex');


/* ---------- Una sola operación a la vez ---------- */

let operacionEnCurso = null;

async function conGuardia(nombre, funcion) {
  if (operacionEnCurso) {
    throw new ErrorApp(409, `Hay un ${operacionEnCurso} en curso. Espera a que termine e inténtalo de nuevo.`);
  }

  operacionEnCurso = nombre;

  try {
    return await funcion();
  } finally {
    operacionEnCurso = null;
  }
}


/* ---------- Consultas al diccionario de Oracle ---------- */

const marcadoresDe = (valores, prefijo) => ({
  lista: valores.map((_, i) => `:${prefijo}${i}`).join(', '),
  binds: Object.fromEntries(valores.map((v, i) => [`${prefijo}${i}`, v]))
});

// tabla → [{ nombre, tipo }]  (en el orden real de las columnas)
async function leerColumnas(s, tablas, esquema) {
  const { lista, binds } = marcadoresDe(tablas, 't');

  const { rows } = await s.ejecutar(`
    /* respaldo_columnas */
    SELECT table_name, column_name, data_type
      FROM all_tab_columns
     WHERE owner = :esquema AND table_name IN (${lista})
     ORDER BY table_name, column_id`, { esquema, ...binds });

  const estructura = new Map();

  for (const r of rows) {
    if (!IDENTIFICADOR.test(r.TABLE_NAME) || !IDENTIFICADOR.test(r.COLUMN_NAME)) {
      throw new ErrorApp(500, 'Hay nombres de tabla o columna con caracteres especiales; el respaldo no los soporta.');
    }

    if (!estructura.has(r.TABLE_NAME)) estructura.set(r.TABLE_NAME, []);
    estructura.get(r.TABLE_NAME).push({ nombre: r.COLUMN_NAME, tipo: r.DATA_TYPE });
  }

  return estructura;
}

// Columnas "identity" (autonumeradas) de las tablas indicadas
async function leerIdentidades(s, tablas, esquema) {
  const { lista, binds } = marcadoresDe(tablas, 't');

  const { rows } = await s.ejecutar(`
    /* respaldo_identidades */
    SELECT table_name, column_name, generation_type
      FROM all_tab_identity_cols
     WHERE owner = :esquema AND table_name IN (${lista})`, { esquema, ...binds });

  // ¿Alguna es "ON NULL"? (no existe en todas las versiones: si falla, se asume que no)
  let alNull = new Set();

  try {
    const r = await s.ejecutar(`
      /* respaldo_identidades_on_null */
      SELECT table_name, column_name
        FROM all_tab_columns
       WHERE owner = :esquema AND table_name IN (${lista}) AND identity_column = 'YES' AND default_on_null = 'YES'`,
      { esquema, ...binds });

    alNull = new Set(r.rows.map((x) => `${x.TABLE_NAME}.${x.COLUMN_NAME}`));
  } catch { /* se mantiene vacío */ }

  return rows.map((r) => ({
    tabla: r.TABLE_NAME,
    columna: r.COLUMN_NAME,
    modo: String(r.GENERATION_TYPE).toUpperCase().startsWith('ALWAYS') ? 'ALWAYS' : 'BY DEFAULT',
    alNull: alNull.has(`${r.TABLE_NAME}.${r.COLUMN_NAME}`)
  }));
}

/*
  Ordena las tablas para insertar: primero las "padre" y después las que
  dependen de ellas (claves foráneas). Para borrar se usa el orden inverso.
  relaciones: [{ hija, padre }]
*/
export function ordenarPorDependencias(tablas, relaciones) {
  const pendientes = new Map(tablas.map((t) => [t, new Set()]));

  for (const { hija, padre } of relaciones) {
    if (hija !== padre && pendientes.has(hija) && pendientes.has(padre)) pendientes.get(hija).add(padre);
  }

  const orden = [];

  while (pendientes.size) {
    const listas = [...pendientes.keys()].filter((t) => pendientes.get(t).size === 0);

    if (!listas.length) {
      // Dependencia circular: se agregan en el orden original (la base de datos avisará si no calza)
      orden.push(...pendientes.keys());
      return { orden, circular: true };
    }

    for (const t of listas) {
      orden.push(t);
      pendientes.delete(t);
      for (const faltan of pendientes.values()) faltan.delete(t);
    }
  }

  return { orden, circular: false };
}

async function leerDependencias(s, esquema) {
  const { rows } = await s.ejecutar(`
    /* respaldo_dependencias */
    SELECT c.table_name AS hija, p.table_name AS padre
      FROM all_constraints c
      JOIN all_constraints p ON p.owner = c.r_owner AND p.constraint_name = c.r_constraint_name
     WHERE c.constraint_type = 'R' AND c.owner = :esquema`, { esquema });

  return rows.map((r) => ({ hija: r.HIJA, padre: r.PADRE }));
}


/* ---------- Nombres y carpeta de respaldos ---------- */

const marcaDeTiempo = (fecha) => fecha.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);   // 20261110-153045

function fechaDeNombre(nombre) {
  const [, f, h] = /-(\d{8})-(\d{6})/.exec(nombre) || [];
  if (!f) return null;

  return `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}T${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}.000Z`;
}

// Si ya hay respaldos de ese mismo segundo, el nuevo lleva un número mayor (-2, -3...) para que siempre sea el más nuevo
async function elegirNombre(dir, tipo, fecha) {
  const marca = marcaDeTiempo(fecha);
  const mismoSegundo = new RegExp(`^${tipo}-${marca}(?:-(\\d+))?\\.json$`);

  let mayor = 0;

  for (const nombre of await readdir(dir)) {
    const coincide = mismoSegundo.exec(nombre);
    if (coincide) mayor = Math.max(mayor, Number(coincide[1] || 1));
  }

  return mayor === 0 ? `${tipo}-${marca}.json` : `${tipo}-${marca}-${mayor + 1}.json`;
}

export async function listarRespaldos({ dir = config.respaldo.dir } = {}) {
  let nombres;

  try {
    nombres = await readdir(dir);
  } catch {
    return [];    // todavía no hay carpeta: no hay respaldos
  }

  const lista = [];

  for (const archivo of nombres.filter((n) => NOMBRE_ARCHIVO.test(n))) {
    const { size } = await stat(path.join(dir, archivo));
    lista.push({ archivo, tipo: archivo.startsWith('seguridad') ? 'seguridad' : 'respaldo', creado: fechaDeNombre(archivo), tamanoBytes: size });
  }

  // Más nuevo primero: por fecha y, si hay varios en el mismo segundo, por su número (-2, -3...)
  const clave = (nombre) => {
    const [, marca, n] = /-(\d{8}-\d{6})(?:-(\d+))?\.json$/.exec(nombre);
    return { marca, n: Number(n || 1) };
  };

  return lista.sort((a, b) => {
    const [x, y] = [clave(a.archivo), clave(b.archivo)];
    if (x.marca !== y.marca) return x.marca < y.marca ? 1 : -1;
    return y.n - x.n;
  });
}

async function rotar(dir, tipo, maximo) {
  const sobrantes = (await listarRespaldos({ dir })).filter((r) => r.tipo === tipo).slice(maximo);

  for (const r of sobrantes) {
    await unlink(path.join(dir, r.archivo));
    logger.info('respaldo_antiguo_eliminado', { archivo: r.archivo });
  }
}


/* ---------- Crear respaldo ---------- */

async function crearInterno(db, { dir, esquema, tipo, max }) {
  const todas = [...TABLAS_NEGOCIO, ...TABLAS_REGISTRO];
  const fecha = new Date();

  const tablas = {};
  const omitidas = [];

  // Una sola transacción de solo lectura: todas las tablas se leen "de la misma foto" de la base
  await db.sesion(async (s) => {
    try {
      await s.ejecutar('/* respaldo_solo_lectura */ SET TRANSACTION READ ONLY');
    } catch (error) {
      logger.warn('respaldo_sin_lectura_consistente', { motivo: error.message });
    }

    const estructura = await leerColumnas(s, todas, esquema);

    for (const tabla of todas) {
      const columnas = estructura.get(tabla);

      if (!columnas) { omitidas.push(tabla); continue; }      // la tabla no existe (ej. aún no se creó AUDITORIA)

      const noSoportada = columnas.find((c) => !TIPO_SOPORTADO.test(c.tipo));
      if (noSoportada) {
        throw new ErrorApp(500, `La tabla ${tabla} tiene la columna ${noSoportada.nombre} de tipo ${noSoportada.tipo}, que el respaldo no soporta.`);
      }

      const largos = columnas.filter((c) => esTextoLargo(c.tipo));
      const opciones = largos.length
        ? { fetchInfo: Object.fromEntries(largos.map((c) => [c.nombre, { type: s.texto }])) }   // CLOB → texto
        : {};

      const { rows } = await s.ejecutar(`
        /* respaldo_leer */
        SELECT ${columnas.map((c) => c.nombre).join(', ')} FROM ${tabla} ORDER BY 1`, {}, opciones);

      tablas[tabla] = { columnas, filas: rows };
    }
  });

  const contenido = { formato: FORMATO, version: VERSION, creado: fecha.toISOString(), esquema, integridad: huella(tablas), tablas };

  await mkdir(dir, { recursive: true });

  const archivo = await elegirNombre(dir, tipo, fecha);
  const temporal = path.join(dir, `${archivo}.tmp`);

  await writeFile(temporal, JSON.stringify(contenido), 'utf8');
  await rename(temporal, path.join(dir, archivo));       // el archivo aparece completo o no aparece

  await rotar(dir, tipo, tipo === 'seguridad' ? CONSERVAR_SEGURIDAD : max);

  const { size } = await stat(path.join(dir, archivo));

  return {
    archivo,
    tipo,
    creado: contenido.creado,
    tamanoBytes: size,
    tablas: Object.fromEntries(Object.entries(tablas).map(([nombre, t]) => [nombre, t.filas.length])),
    omitidas
  };
}

export function crearRespaldo(db, { dir = config.respaldo.dir, esquema = esquemaActual(), tipo = 'respaldo', max = config.respaldo.max } = {}) {
  return conGuardia('respaldo', () => crearInterno(db, { dir, esquema, tipo, max }));
}


/* ---------- Leer y validar un archivo de respaldo ---------- */

async function leerArchivo(dir, archivo) {
  if (!NOMBRE_ARCHIVO.test(String(archivo))) throw new ErrorApp(400, 'El nombre del archivo de respaldo no es válido.');

  let texto;

  try {
    texto = await readFile(path.join(dir, archivo), 'utf8');
  } catch {
    throw new ErrorApp(404, 'No se encontró ese archivo de respaldo.');
  }

  let contenido;

  try {
    contenido = JSON.parse(texto);
  } catch {
    throw new ErrorApp(400, 'El archivo de respaldo está dañado (no se puede leer).');
  }

  if (contenido.formato !== FORMATO || contenido.version !== VERSION || typeof contenido.tablas !== 'object' || !contenido.tablas) {
    throw new ErrorApp(400, 'El archivo no es un respaldo de El bajón de Maite compatible.');
  }

  if (huella(contenido.tablas) !== contenido.integridad) {
    throw new ErrorApp(400, 'El respaldo está dañado: la verificación de integridad (SHA-256) falló.');
  }

  return contenido;
}

const convertir = (valor, tipo) => (valor !== null && valor !== undefined && esFecha(tipo) ? new Date(valor) : valor);


/* ---------- Restaurar ---------- */

async function restaurarInterno(db, archivo, { dir, esquema, max }) {
  const contenido = await leerArchivo(dir, archivo);

  const aRestaurar = TABLAS_NEGOCIO.filter((t) => contenido.tablas[t]);
  if (!aRestaurar.length) throw new ErrorApp(400, 'El respaldo no contiene tablas del negocio para restaurar.');

  // 1. Revisar que la base actual sea compatible con el archivo (antes de tocar nada)
  const { estructura, identidades, dependencias } = await db.sesion(async (s) => ({
    estructura: await leerColumnas(s, TABLAS_NEGOCIO, esquema),
    identidades: await leerIdentidades(s, TABLAS_NEGOCIO, esquema),
    dependencias: await leerDependencias(s, esquema)
  }));

  // Tablas que existen hoy pero no estaban en el respaldo (ej. PAGO si el respaldo es anterior a que se creara):
  // en aquel momento estaban vacías, así que se vacían también (sus filas apuntarían a pedidos que ya no existen)
  const soloVaciar = TABLAS_NEGOCIO.filter((t) => !contenido.tablas[t] && estructura.has(t));

  for (const tabla of aRestaurar) {
    const actuales = estructura.get(tabla);
    if (!actuales) throw new ErrorApp(409, `La tabla ${tabla} ya no existe en la base de datos.`);

    for (const columna of contenido.tablas[tabla].columnas) {
      if (!IDENTIFICADOR.test(columna.nombre) || !TIPO_SOPORTADO.test(columna.tipo)) {
        throw new ErrorApp(400, `El respaldo tiene una columna no válida en ${tabla}.`);
      }
      if (!actuales.some((c) => c.nombre === columna.nombre)) {
        throw new ErrorApp(409, `La estructura cambió: ${tabla} ya no tiene la columna ${columna.nombre}. Este respaldo no se puede restaurar.`);
      }
    }
  }

  const { orden: ordenCompleto, circular } = ordenarPorDependencias([...aRestaurar, ...soloVaciar], dependencias);
  const orden = ordenCompleto.filter((t) => aRestaurar.includes(t));
  const advertencias = circular ? ['Hay dependencias circulares entre tablas; se usó el orden por defecto.'] : [];

  // 2. Respaldo de seguridad del estado actual (si algo sale mal, se puede volver atrás con él)
  const seguridad = await crearInterno(db, { dir, esquema, tipo: 'seguridad', max });

  // 3. Las columnas identity "ALWAYS" no aceptan ids explícitos: se pasan a "BY DEFAULT" solo durante
  //    la restauración y se devuelven a su modo original (con el contador al día) en el bloque finally.
  const autonumeradas = identidades.filter((i) => IDENTIFICADOR.test(i.tabla) && IDENTIFICADOR.test(i.columna));

  try {
    for (const i of autonumeradas.filter((x) => x.modo === 'ALWAYS')) {
      await db.ejecutar(`/* respaldo_identidad_ajustar */ ALTER TABLE ${i.tabla} MODIFY (${i.columna} GENERATED BY DEFAULT AS IDENTITY)`);
    }

    // 4. Borrar y volver a insertar, todo en una transacción (si falla, rollback automático)
    await db.sesion(async (s) => {
      for (const tabla of [...ordenCompleto].reverse()) {
        await s.ejecutar(`/* respaldo_borrar */ DELETE FROM ${tabla}`);
      }

      for (const tabla of orden) {
        const { columnas, filas } = contenido.tablas[tabla];
        const nombres = columnas.map((c) => c.nombre);
        const sql = `/* respaldo_insertar */ INSERT INTO ${tabla} (${nombres.join(', ')}) VALUES (${nombres.map((_, i) => `:c${i}`).join(', ')})`;

        for (const fila of filas) {
          const binds = Object.fromEntries(columnas.map((c, i) => [`c${i}`, convertir(fila[c.nombre], c.tipo)]));
          await s.ejecutar(sql, binds);
        }
      }
    });
  } catch (error) {
    logger.error('restauracion_fallida', { archivo, motivo: error.message });

    if (error instanceof ErrorApp) throw error;
    throw new ErrorApp(500, `No se pudo restaurar el respaldo. Los datos quedaron como estaban (respaldo de seguridad: ${seguridad.archivo}). Revisa los logs del servidor.`);
  } finally {
    // 5. Dejar los autonuméricos como estaban y con el contador después del id más alto
    for (const i of autonumeradas) {
      const modo = i.modo === 'ALWAYS' ? 'ALWAYS' : `BY DEFAULT${i.alNull ? ' ON NULL' : ''}`;

      try {
        await db.ejecutar(`/* respaldo_identidad_ajustar */ ALTER TABLE ${i.tabla} MODIFY (${i.columna} GENERATED ${modo} AS IDENTITY (START WITH LIMIT VALUE))`);
      } catch (error) {
        logger.error('respaldo_identidad_pendiente', { tabla: i.tabla, motivo: error.message });
        advertencias.push(`No se pudo ajustar el contador de ${i.tabla}.${i.columna}. Ejecuta manualmente: ALTER TABLE ${i.tabla} MODIFY (${i.columna} GENERATED ${modo} AS IDENTITY (START WITH LIMIT VALUE))`);
      }
    }
  }

  return {
    archivo,
    creado: contenido.creado,
    restauradas: Object.fromEntries(orden.map((t) => [t, contenido.tablas[t].filas.length])),
    vaciadas: soloVaciar,
    respaldoDeSeguridad: seguridad.archivo,
    advertencias
  };
}

export function restaurarRespaldo(db, archivo, { dir = config.respaldo.dir, esquema = esquemaActual(), max = config.respaldo.max } = {}) {
  return conGuardia('restauración', () => restaurarInterno(db, archivo, { dir, esquema, max }));
}


/* ---------- Respaldo automático ---------- */

export function respaldoVencido(ultimoCreado, cadaHoras, ahora = Date.now()) {
  if (!ultimoCreado) return true;
  return ahora - Date.parse(ultimoCreado) >= cadaHoras * 60 * 60 * 1000;
}

/* Revisa cada hora (o antes, si el intervalo es menor) si ya toca un respaldo.
   Devuelve una función para detener el temporizador. */
export function iniciarRespaldoAutomatico(db, { cadaHoras = config.respaldo.cadaHoras, dir = config.respaldo.dir, max = config.respaldo.max, primeraRevisionMs = 15000 } = {}) {
  if (!cadaHoras) {
    logger.info('respaldo_automatico_desactivado');
    return () => {};
  }

  const revisar = async () => {
    try {
      const ultimo = (await listarRespaldos({ dir })).find((r) => r.tipo === 'respaldo');
      if (!respaldoVencido(ultimo && ultimo.creado, cadaHoras)) return;

      const respaldo = await crearRespaldo(db, { dir, max });
      const filas = Object.values(respaldo.tablas).reduce((a, b) => a + b, 0);

      await registrarAuditoria(db, {
        usuario: 'sistema', rol: 'sistema', accion: 'RESPALDO_AUTOMATICO', entidad: 'RESPALDO',
        idEntidad: respaldo.archivo, detalle: `${Object.keys(respaldo.tablas).length} tablas, ${filas} filas`
      });
    } catch (error) {
      logger.error('respaldo_automatico_fallido', { motivo: error.message });
      if (error.estado !== 409) alertarRespaldoFallido(error.message);      // 409 = ya había otra operación en curso, no es un fallo
    }
  };

  const primera = setTimeout(revisar, primeraRevisionMs);
  const intervalo = setInterval(revisar, Math.max(60000, Math.min(cadaHoras, 1) * 60 * 60 * 1000));

  logger.info('respaldo_automatico_activo', { cadaHoras, max });

  return () => {
    clearTimeout(primera);
    clearInterval(intervalo);
  };
}
