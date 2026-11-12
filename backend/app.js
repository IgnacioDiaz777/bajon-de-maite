/* ==========================================================
   APLICACIÓN EXPRESS
   Recibe la conexión a la base de datos ("db") para poder
   probarla sin Oracle real.
   ========================================================== */

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { rutasAuth } from './routes/auth.js';
import { rutasProductos } from './routes/productos.js';
import { rutasPedidos } from './routes/pedidos.js';
import { rutasUsuarios } from './routes/usuarios.js';
import { rutasAuditoria } from './routes/auditoria.js';
import { rutasFeedback } from './routes/feedback.js';
import { rutasMonitoreo } from './routes/monitoreo.js';
import { rutasRespaldos } from './routes/respaldos.js';
import { rutasNotificaciones } from './routes/notificaciones.js';
import { rutasClientes } from './routes/clientes.js';
import { rutasPerfil } from './routes/perfil.js';
import { rutasPagos } from './routes/pagos.js';
import { rutasAnalitica } from './routes/analitica.js';
import { crearProveedorPagos } from './services/pagos/index.js';
import { medirRendimiento } from './middleware/rendimiento.js';
import { noEncontrado, manejarErrores } from './middleware/errores.js';


// proveedorPagos y configPagos se pueden reemplazar (las pruebas usan un proveedor propio)
export function crearApp({ db, proveedorPagos = crearProveedorPagos(), configPagos = config.pagos }) {
  const app = express();

  app.use(medirRendimiento); // Sprint 4 · #27: mide cuánto tarda cada solicitud
  app.use(cors({ origin: config.corsOrigenes }));
  app.use(express.json({ limit: '50kb' })); // Middleware para entender datos en formato JSON

  // Comprueba que la API y Oracle responden
  app.get('/api/salud', async (req, res) => {
    try {
      await db.ejecutar('/* ping */ SELECT 1 AS ok FROM dual');
      res.json({ status: 'success', api: 'ok', baseDeDatos: 'ok' });
    } catch (error) {
      console.error('Fallo la comprobación de Oracle:', error.message);
      res.status(503).json({ status: 'error', api: 'ok', baseDeDatos: 'sin conexión' });
    }
  });

  app.use('/api/auth', rutasAuth(db));
  app.use('/api/productos', rutasProductos(db));
  app.use('/api/pedidos', rutasPedidos(db));
  app.use('/api/usuarios', rutasUsuarios(db));

  // Sprint 4
  app.use('/api/auditoria', rutasAuditoria(db));     // #29 Auditoría y logs de transacciones
  app.use('/api/feedback', rutasFeedback(db));       // #28 Feedback y reporte de fallos
  app.use('/api/monitoreo', rutasMonitoreo(db));     // #27 Monitoreo de rendimiento
  app.use('/api/respaldos', rutasRespaldos(db));     // #30 Respaldo y restauración

  // Tareas 31 a 34
  app.use('/api/notificaciones', rutasNotificaciones());                      // #31 Alertas en tiempo real
  app.use('/api/pagos', rutasPagos(db, proveedorPagos, configPagos));         // #32 Pasarela de pagos
  app.use('/api/clientes', rutasClientes(db));                                // #33 Perfiles y direcciones de despacho
  app.use('/api/perfil', rutasPerfil(db));                                    // #33 Perfil del usuario con sesión
  app.use('/api/analitica', rutasAnalitica(db));                              // #34 Panel analítico de ventas

  app.use(noEncontrado);
  app.use(manejarErrores);

  return app;
}
