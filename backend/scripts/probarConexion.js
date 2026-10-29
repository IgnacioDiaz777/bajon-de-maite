/* ==========================================================
   PRUEBA DE CONEXIÓN CON ORACLE  →  npm run probar-conexion
   Verifica credenciales, esquema y que existan las tablas.
   ========================================================== */

import { validarConfig } from '../config/env.js';
import { db, iniciarPool, cerrarPool } from '../db/oracle.js';


const TABLAS = ['USUARIO', 'ADMINISTRADOR', 'CAJERO', 'COCINERO', 'CLIENTE', 'PRODUCTO', 'PEDIDO', 'DETALLE_PEDIDO', 'VENTA', 'REPORTE'];

try {
  validarConfig();
  await iniciarPool();

  const quien = await db.ejecutar(`SELECT USER AS usuario, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS esquema FROM dual`);
  console.log(`Conectado como ${quien.rows[0].USUARIO} (esquema ${quien.rows[0].ESQUEMA})`);

  let faltan = 0;

  for (const tabla of TABLAS) {
    try {
      const r = await db.ejecutar(`SELECT COUNT(*) AS n FROM ${tabla}`); // nombres fijos de la lista de arriba
      console.log(`  OK    ${tabla.padEnd(15)} ${r.rows[0].N} registros`);
    } catch (error) {
      faltan += 1;
      console.log(`  FALLA ${tabla.padEnd(15)} ${error.message.split('\n')[0]}`);
    }
  }

  const sp = await db.ejecutar(`SELECT object_name FROM all_objects WHERE object_name = 'SP_CREAR_PEDIDO' AND object_type = 'PROCEDURE'`);
  console.log(sp.rows.length ? '  OK    SP_CREAR_PEDIDO' : '  FALLA SP_CREAR_PEDIDO (no visible desde este usuario)');

  process.exitCode = faltan || !sp.rows.length ? 1 : 0;
} catch (error) {
  console.error('No se pudo completar la prueba:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
