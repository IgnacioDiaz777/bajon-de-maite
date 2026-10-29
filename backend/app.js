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
import { noEncontrado, manejarErrores } from './middleware/errores.js';


export function crearApp({ db }) {
  const app = express();

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

  app.use(noEncontrado);
  app.use(manejarErrores);

  return app;
}
