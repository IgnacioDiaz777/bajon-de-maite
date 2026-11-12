/* ==========================================================
   MANEJO CENTRAL DE ERRORES
   Nunca se devuelven detalles de Oracle ni credenciales.
   ========================================================== */

import { ErrorApp } from '../services/errores.js';
import { logger } from '../services/logger.js';


export function noEncontrado(req, res) {
  res.status(404).json({ status: 'error', errors: ['Ruta no encontrada.'] });
}

export function manejarErrores(error, req, res, next) {
  if (error instanceof ErrorApp) {
    return res.status(error.estado).json({ status: 'error', errors: [error.message] });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', errors: ['El cuerpo de la solicitud no es JSON válido.'] });
  }

  // Restricciones de la base de datos que llegaron hasta aquí
  if (error.errorNum === 1) {
    return res.status(409).json({ status: 'error', errors: ['Ya existe un registro con esos datos.'] });
  }

  if (error.errorNum === 2290 || error.errorNum === 2291) {
    return res.status(400).json({ status: 'error', errors: ['Los datos no cumplen las reglas de la base de datos.'] });
  }

  // ORA-00942: falta una tabla (lo normal: todavía no se ejecutó npm run crear-tablas del Sprint 4)
  if (error.errorNum === 942) {
    logger.error('tabla_faltante', { motivo: error.message, ruta: `${req.method} ${req.originalUrl}` });
    return res.status(503).json({ status: 'error', errors: ['Falta una tabla en la base de datos. Ejecuta "npm run crear-tablas" en la carpeta backend.'] });
  }

  // Sin conexión con Oracle (NJS-xxx, ORA-125xx, ORA-01017 ...)
  if (/^(NJS|DPI)-/.test(error.message || '') || [1017, 12154, 12541, 12514, 12170].includes(error.errorNum)) {
    logger.error('error_conexion_oracle', { motivo: error.message, ruta: `${req.method} ${req.originalUrl}` });
    return res.status(503).json({ status: 'error', errors: ['No hay conexión con la base de datos. Inténtalo en unos minutos.'] });
  }

  logger.error('error_interno', { motivo: error.message, ruta: `${req.method} ${req.originalUrl}`, usuario: req.usuario && req.usuario.usuario });
  res.status(500).json({ status: 'error', errors: ['Ocurrió un error interno. Inténtalo nuevamente.'] });
}
