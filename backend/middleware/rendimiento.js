/* ==========================================================
   MIDDLEWARE DE RENDIMIENTO
   Sprint 4 · #27 Monitoreo de rendimiento en carga
   Mide cuánto tarda cada solicitud y avisa en los logs
   cuando alguna supera el umbral (MONITOREO_UMBRAL_MS).
   ========================================================== */

import { config } from '../config/env.js';
import { logger } from '../services/logger.js';
import { medidor } from '../services/monitorService.js';


// 'GET /api/productos/:id' en vez de 'GET /api/productos/17': agrupa las rutas iguales
function nombreDeRuta(req) {
  if (!req.route) return `${req.method} (sin ruta)`;

  const ruta = `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` || '/';
  return `${req.method} ${ruta}`;
}


export function medirRendimiento(req, res, next) {
  const inicio = performance.now();

  res.on('finish', () => {
    if (res.locals.omitirMedicion) return;      // ej. la conexión de notificaciones en tiempo real dura horas

    const duracionMs = performance.now() - inicio;
    const ruta = nombreDeRuta(req);

    medidor.registrar({ ruta, estado: res.statusCode, duracionMs });

    if (duracionMs > config.monitoreo.umbralLentoMs) {
      logger.warn('solicitud_lenta', { ruta, estado: res.statusCode, duracionMs: Math.round(duracionMs) });
    }
  });

  next();
}
