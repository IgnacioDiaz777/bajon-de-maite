import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { medidor, medirBaseDeDatos } from '../services/monitorService.js';


export function rutasMonitoreo(db) {
  const router = Router();

  router.use(autenticar, exigirRol('administrador'));

  // Estado del servidor, tiempos por ruta y latencia de Oracle
  router.get('/', async (req, res) => {
    res.json({
      status: 'success',
      data: { ...medidor.resumen(), baseDeDatos: await medirBaseDeDatos(db) }
    });
  });

  // Empieza a medir desde cero (útil antes de una prueba de carga)
  router.post('/reiniciar', (req, res) => {
    medidor.reiniciar();
    res.json({ status: 'success', message: 'Las mediciones se reiniciaron.' });
  });

  return router;
}
