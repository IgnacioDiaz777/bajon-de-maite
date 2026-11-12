import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { validateAnaliticaVentas } from '../validators/analiticaValidator.js';
import { ventasDelPeriodo } from '../services/analiticaService.js';


export function rutasAnalitica(db) {
  const router = Router();

  router.use(autenticar, exigirRol('administrador'));

  // GET /api/analitica/ventas?desde=2026-11-01&hasta=2026-11-10
  router.get('/ventas', validateAnaliticaVentas, async (req, res) => {
    res.json({ status: 'success', data: await ventasDelPeriodo(db, req.consulta) });
  });

  return router;
}
