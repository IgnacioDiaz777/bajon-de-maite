/* ==========================================================
   REGISTRO DE EVENTOS (LOGS)
   Sprint 4 · #29 Auditoría y logs de transacciones

   Cada evento se escribe en la consola y en un archivo diario
   backend/logs/app-AAAA-MM-DD.log, una línea JSON por evento:

     {"ts":"2026-11-10T15:30:00.000Z","nivel":"info","mensaje":"auditoria",...}

   Nunca debe romper la app: si no se puede escribir el archivo,
   solo se avisa por consola. Nunca se registran contraseñas.
   ========================================================== */

import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';


const NIVELES = { debug: 10, info: 20, warn: 30, error: 40 };
const ARCHIVO_LOG = /^app-\d{4}-\d{2}-\d{2}\.log$/;

let avisoEscrituraMostrado = false;


function escribirEnArchivo(linea, fecha) {
  if (!config.logs.archivo) return;

  const nombre = `app-${fecha.toISOString().slice(0, 10)}.log`;

  mkdir(config.logs.dir, { recursive: true })
    .then(() => appendFile(path.join(config.logs.dir, nombre), linea + '\n', 'utf8'))
    .catch((error) => {
      if (avisoEscrituraMostrado) return;
      avisoEscrituraMostrado = true;
      console.error('No se pudo escribir el archivo de logs:', error.message);
    });
}


function registrar(nivel, mensaje, datos = {}) {
  const ahora = new Date();
  const evento = { ts: ahora.toISOString(), nivel, mensaje, ...datos };

  // La consola solo muestra avisos y errores (el detalle completo queda en el archivo)
  if (NIVELES[nivel] >= NIVELES.warn) {
    const salida = nivel === 'error' ? console.error : console.warn;
    salida(`[${nivel}] ${mensaje}`, Object.keys(datos).length ? datos : '');
  }

  escribirEnArchivo(JSON.stringify(evento), ahora);
}


export const logger = {
  debug: (mensaje, datos) => registrar('debug', mensaje, datos),
  info: (mensaje, datos) => registrar('info', mensaje, datos),
  warn: (mensaje, datos) => registrar('warn', mensaje, datos),
  error: (mensaje, datos) => registrar('error', mensaje, datos)
};


/* Borra los archivos de log más antiguos que LOG_DIAS (30 por defecto) */
export async function limpiarLogsAntiguos(ahora = Date.now()) {
  const limite = ahora - config.logs.diasConservar * 24 * 60 * 60 * 1000;
  let borrados = 0;

  try {
    for (const nombre of await readdir(config.logs.dir)) {
      if (!ARCHIVO_LOG.test(nombre)) continue;

      const fecha = Date.parse(nombre.slice(4, 14));
      if (Number.isNaN(fecha) || fecha >= limite) continue;

      await unlink(path.join(config.logs.dir, nombre));
      borrados += 1;
    }
  } catch {
    /* la carpeta todavía no existe: no hay nada que limpiar */
  }

  return borrados;
}
