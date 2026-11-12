/* ==========================================================
   CREAR UN RESPALDO AHORA  →  npm run respaldo
   Guarda las tablas en backend/respaldos/respaldo-....json
   Sirve para programarlo con el Programador de tareas de
   Windows (o cron) aunque el servidor no esté encendido.
   ========================================================== */

import { validarConfig, config } from '../config/env.js';
import { db, iniciarPool, cerrarPool } from '../db/oracle.js';
import { crearRespaldo } from '../services/backupService.js';
import { registrarAuditoria } from '../services/auditService.js';


try {
  validarConfig();
  await iniciarPool();

  const respaldo = await crearRespaldo(db);

  console.log(`Respaldo creado: ${respaldo.archivo} (${Math.round(respaldo.tamanoBytes / 1024)} KB) en ${config.respaldo.dir}`);

  for (const [tabla, filas] of Object.entries(respaldo.tablas)) {
    console.log(`  ${tabla.padEnd(15)} ${filas} registros`);
  }

  if (respaldo.omitidas.length) {
    console.log(`\nTablas que no existen y se omitieron: ${respaldo.omitidas.join(', ')}`);
    if (respaldo.omitidas.some((t) => ['AUDITORIA', 'FEEDBACK'].includes(t))) console.log('Crea AUDITORIA y FEEDBACK con: npm run crear-tablas');
  }

  await registrarAuditoria(db, {
    usuario: 'terminal', rol: 'sistema', accion: 'RESPALDO_CREAR', entidad: 'RESPALDO', idEntidad: respaldo.archivo, detalle: 'Creado con npm run respaldo'
  });
} catch (error) {
  console.error('No se pudo crear el respaldo:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
