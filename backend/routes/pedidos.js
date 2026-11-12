import { Router } from 'express';
import { validateOrder } from '../validators/orderValidator.js';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { ErrorApp } from '../services/errores.js';
import { listarPedidosActivos, crearPedido, avanzarPedido } from '../services/orderService.js';
import { alertarPedidoNuevo, alertarPedidoListo, alertarStockBajo } from '../services/alertasService.js';


export function rutasPedidos(db) {
  const router = Router();

  // Pedidos en cocina (pendientes, en preparación y listos para retirar)
  router.get('/', autenticar, async (req, res) => {
    res.json({ status: 'success', data: await listarPedidosActivos(db) });
  });

  // Registrar un pedido nuevo y enviarlo a cocina (queda en AUDITORIA, también si falla)
  router.post('/', autenticar,
    auditar(db, {
      accion: 'PEDIDO_CREAR',
      entidad: 'PEDIDO',
      idEntidad: (req, cuerpo) => cuerpo.data && cuerpo.data.numero,
      detalle: (req, cuerpo) => `Cliente: ${req.body.nombreCliente} · ${req.body.tipoEntrega} · total $${cuerpo.data.total}`
    }),
    exigirRol('administrador', 'cajero'), validateOrder,
    async (req, res) => {
      const pedido = await crearPedido(db, req.body);

      // Avisos en tiempo real: la cocina ve el pedido al instante y el administrador, el stock bajo
      alertarPedidoNuevo(pedido);
      alertarStockBajo(db, req.body.productos.map((p) => p.productoId));

      res.status(201).json({ status: 'success', message: '¡Pedido registrado y enviado a la cocina!', data: pedido });
    });

  // En preparación → Listo (cocinero) → Entregado (cajero). El administrador puede ambos.
  router.post('/:id/avanzar', autenticar,
    auditar(db, {
      accion: 'PEDIDO_AVANZAR',
      entidad: 'PEDIDO',
      idEntidad: (req) => req.params.id,
      detalle: (req, cuerpo) => `Nuevo estado: ${cuerpo.data.estado}`
    }),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'El id del pedido no es válido.');

      const pedido = await avanzarPedido(db, id, req.usuario.rol);
      if (pedido.estado === 'Listo para retirar') alertarPedidoListo(pedido);

      res.json({ status: 'success', data: pedido });
    });

  return router;
}
