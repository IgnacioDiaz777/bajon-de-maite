import { Router } from 'express';
import { autenticar } from '../middleware/auth.js';
import { conectar, listarAvisos } from '../services/eventosService.js';


export function rutasNotificaciones() {
  const router = Router();

  // Últimos avisos que le corresponden a este usuario (para mostrar al entrar)
  router.get('/', autenticar, (req, res) => {
    res.json({ status: 'success', data: listarAvisos(req.usuario) });
  });

  // Conexión en tiempo real (Server-Sent Events). El navegador usa fetch con su token,
  // así el token viaja en la cabecera y no en la dirección.
  router.get('/flujo', autenticar, (req, res) => {
    res.locals.omitirMedicion = true;       // una conexión larga no cuenta como "solicitud lenta"

    const ultimo = Number(req.headers['last-event-id'] || req.query.desde) || 0;
    conectar(req, res, req.usuario, ultimo);
  });

  return router;
}
