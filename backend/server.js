/* ==========================================================
   ARRANQUE DEL SERVIDOR BACKEND  →  npm start
   ========================================================== */

import { config, validarConfig } from './config/env.js';
import { crearApp } from './app.js';
import { db, iniciarPool, cerrarPool } from './db/oracle.js';
import { logger, limpiarLogsAntiguos } from './services/logger.js';
import { iniciarRespaldoAutomatico } from './services/backupService.js';
import { crearProveedorPagos } from './services/pagos/index.js';
import { iniciarConciliacionPagos } from './services/pagoService.js';
import { cerrarConexiones } from './services/eventosService.js';


validarConfig();

try {
  await iniciarPool();
  await db.ejecutar('SELECT 1 FROM dual');
  console.log('Conexión con Oracle establecida.');
} catch (error) {
  console.error('No se pudo conectar con Oracle:', error.message);
  console.error('Revisa backend/.env y ejecuta: npm run probar-conexion');
  process.exit(1);
}

const proveedorPagos = crearProveedorPagos();

const servidor = crearApp({ db, proveedorPagos }).listen(config.puerto, () => {
  console.log(`Servidor backend corriendo en http://localhost:${config.puerto}`);
  logger.info('servidor_iniciado', { puerto: config.puerto });
  console.log(`Pagos con tarjeta: proveedor ${proveedorPagos.nombre}${proveedorPagos.nombre === 'transbank' ? ` (${config.pagos.ambiente})` : ' (pantalla de pago simulada, solo para pruebas)'}`);
});

// Sprint 4 · #29: borra los logs más viejos que LOG_DIAS
limpiarLogsAntiguos().then((borrados) => {
  if (borrados) logger.info('logs_antiguos_eliminados', { borrados });
});

// Tarea #32: cada 10 minutos se vencen los pagos sin terminar y se consulta a la pasarela por los que quedaron a medias
const detenerConciliacion = iniciarConciliacionPagos(db, proveedorPagos, config.pagos);

// Sprint 4 · #30: respaldo automático (cada RESPALDO_CADA_HORAS; 0 lo desactiva)
const detenerRespaldos = iniciarRespaldoAutomatico(db);

if (config.respaldo.cadaHoras) {
  console.log(`Respaldo automático activo: cada ${config.respaldo.cadaHoras} h en ${config.respaldo.dir}`);
}


/* Errores que nadie capturó: quedan en los logs (y un error grave apaga el servidor) */
process.on('unhandledRejection', (motivo) => {
  logger.error('promesa_sin_capturar', { motivo: String(motivo && motivo.message ? motivo.message : motivo) });
});

process.on('uncaughtException', async (error) => {
  logger.error('excepcion_sin_capturar', { motivo: error.message });
  detenerRespaldos();
  detenerConciliacion();
  setTimeout(() => process.exit(1), 300);   // deja un instante para escribir el log
});

process.on('SIGINT', async () => {
  detenerRespaldos();
  detenerConciliacion();
  cerrarConexiones();                     // cierra las conexiones de notificaciones para poder apagar
  servidor.close();
  await cerrarPool();
  process.exit(0);
});
