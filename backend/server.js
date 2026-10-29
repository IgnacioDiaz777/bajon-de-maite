/* ==========================================================
   ARRANQUE DEL SERVIDOR BACKEND  →  npm start
   ========================================================== */

import { config, validarConfig } from './config/env.js';
import { crearApp } from './app.js';
import { db, iniciarPool, cerrarPool } from './db/oracle.js';


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

const servidor = crearApp({ db }).listen(config.puerto, () => {
  console.log(`Servidor backend corriendo en http://localhost:${config.puerto}`);
});

process.on('SIGINT', async () => {
  servidor.close();
  await cerrarPool();
  process.exit(0);
});
