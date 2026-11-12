import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { validateAuditoriaFiltros } from '../validators/auditoriaValidator.js';
import { listarAuditoria } from '../services/auditService.js';


export function rutasAuditoria(db) {
  const router = Router();

  router.use(autenticar, exigirRol('administrador'));

  // GET /api/auditoria?usuario=maite&accion=PEDIDO_CREAR&resultado=FALLO&desde=2026-11-01&hasta=2026-11-10
  router.get('/', validateAuditoriaFiltros, async (req, res) => {
    res.json({ status: 'success', data: await listarAuditoria(db, req.consulta) });
  });

  return router;
}
