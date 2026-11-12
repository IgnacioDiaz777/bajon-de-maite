import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { ErrorApp } from '../services/errores.js';
import { validateFeedback, validateFeedbackEstado, validateFeedbackFiltros } from '../validators/feedbackValidator.js';
import { alertarFalloGrave } from '../services/alertasService.js';
import { crearFeedback, listarFeedback, cambiarEstadoFeedback, limitarEnvios } from '../services/feedbackService.js';


export function rutasFeedback(db) {
  const router = Router();

  // Cualquier rol puede enviar un comentario, sugerencia o reporte de fallo
  router.post('/', autenticar, validateFeedback, async (req, res) => {
    limitarEnvios(req.usuario.id);

    const reporte = await crearFeedback(db, req.usuario, req.body);
    if (reporte.tipo === 'FALLO' && reporte.gravedad === 'ALTA') alertarFalloGrave({ ...reporte, usuario: req.usuario.usuario });
    res.status(201).json({ status: 'success', message: '¡Gracias! Recibimos tu reporte.', data: reporte });
  });

  // El administrador ve todos los reportes; los demás roles, solo los suyos
  router.get('/', autenticar, validateFeedbackFiltros, async (req, res) => {
    res.json({ status: 'success', data: await listarFeedback(db, req.usuario, req.consulta) });
  });

  // Solo el administrador cambia el estado (ABIERTO → EN_REVISION → RESUELTO)
  router.patch('/:id/estado', autenticar,
    auditar(db, {
      accion: 'FEEDBACK_ESTADO',
      entidad: 'FEEDBACK',
      idEntidad: (req) => req.params.id,
      detalle: (req) => `Nuevo estado: ${req.body && req.body.estado}`
    }),
    exigirRol('administrador'), validateFeedbackEstado,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'El id del reporte no es válido.');

      res.json({ status: 'success', message: 'Reporte actualizado.', data: await cambiarEstadoFeedback(db, id, req.body.estado) });
    });

  return router;
}
