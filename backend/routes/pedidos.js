import { Router } from 'express';
import { validateOrder } from '../validators/orderValidator.js';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { ErrorApp } from '../services/errores.js';
import { listarPedidosActivos, crearPedido, avanzarPedido } from '../services/orderService.js';


export function rutasPedidos(db) {
  const router = Router();

  // Pedidos en cocina (pendientes, en preparación y listos para retirar)
  router.get('/', autenticar, async (req, res) => {
    res.json({ status: 'success', data: await listarPedidosActivos(db) });
  });

  // Registrar un pedido nuevo y enviarlo a cocina
  router.post('/', autenticar, exigirRol('administrador', 'cajero'), validateOrder, async (req, res) => {
    const pedido = await crearPedido(db, req.body);
    res.status(201).json({ status: 'success', message: '¡Pedido registrado y enviado a la cocina!', data: pedido });
  });

  // En preparación → Listo (cocinero) → Entregado (cajero). El administrador puede ambos.
  router.post('/:id/avanzar', autenticar, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'El id del pedido no es válido.');

    res.json({ status: 'success', data: await avanzarPedido(db, id, req.usuario.rol) });
  });

  return router;
}
