/* ==========================================================
   CREAR LAS TABLAS NUEVAS  →  npm run crear-tablas
   Ejecuta, en este orden:
     backend/sql/sprint4_tablas.sql        AUDITORIA y FEEDBACK          (#28, #29)
     backend/sql/tareas_31_34_tablas.sql   CLIENTE_PERFIL, DIRECCION_DESPACHO y PAGO  (#32, #33)
   Se puede repetir sin problema: lo que ya existe se omite.
   ========================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validarConfig } from '../config/env.js';
import { db, iniciarPool, cerrarPool } from '../db/oracle.js';


const carpetaSql = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql');
const ARCHIVOS = ['sprint4_tablas.sql', 'tareas_31_34_tablas.sql'];

// Quita los comentarios (-- ...) y separa las sentencias por ";"
const sentencias = ARCHIVOS.flatMap((archivo) => readFileSync(path.join(carpetaSql, archivo), 'utf8')
  .split(/\r?\n/)
  .filter((linea) => !linea.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean));

// ORA-00955: el nombre ya lo usa otro objeto (la tabla o el índice ya existen)
const YA_EXISTE = 955;

try {
  validarConfig();
  await iniciarPool();

  let fallas = 0;

  for (const sql of sentencias) {
    const resumen = sql.replace(/\s+/g, ' ').slice(0, 60);

    try {
      await db.ejecutar(sql);
      console.log(`  OK      ${resumen}…`);
    } catch (error) {
      if (error.errorNum === YA_EXISTE) {
        console.log(`  YA ESTÁ ${resumen}…`);
      } else {
        fallas += 1;
        console.log(`  FALLA   ${resumen}…\n          ${error.message.split('\n')[0]}`);
      }
    }
  }

  console.log(fallas ? `\nTerminó con ${fallas} error(es).` : '\nListo: todas las tablas nuevas están creadas.');
  process.exitCode = fallas ? 1 : 0;
} catch (error) {
  console.error('No se pudo completar:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
