/* ==========================================================
   ALERTAS DEL NEGOCIO
   Tarea #31 Notificaciones push / alertas en tiempo real
   Cada función decide A QUIÉN avisar y con qué texto. Todas son
   "dispara y olvida": un fallo al avisar nunca debe romper la
   operación que lo originó (un pedido, un pago...).
   ========================================================== */

import { publicar } from './eventosService.js';
import { logger } from './logger.js';


export const UMBRAL_STOCK_BAJO = 5;     // el mismo que usa la pantalla de productos ("Pocas unidades")

const numeroPedido = (n) => `#${String(n).padStart(3, '0')}`;
const pesos = (n) => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const cantidadTotal = (pedido) => pedido.items.reduce((s, i) => s + i.cantidad, 0);

// Cualquier error al avisar se registra y se ignora
const seguro = (accion) => {
  try { return accion(); } catch (error) { logger.error('alerta_fallida', { motivo: error.message }); return undefined; }
};


/* ---------- Pedidos ---------- */

export const alertarPedidoNuevo = (pedido) => seguro(() => publicar({
  tipo: 'pedido_nuevo',
  titulo: `Nuevo pedido ${numeroPedido(pedido.numero)}`,
  mensaje: `${pedido.destino} · ${cantidadTotal(pedido)} producto(s) · ${pedido.cliente}`,
  roles: ['cocinero', 'administrador'],
  datos: { numero: pedido.numero }
}));

export const alertarPedidoListo = (pedido) => seguro(() => publicar({
  tipo: 'pedido_listo',
  titulo: `Pedido ${numeroPedido(pedido.numero)} listo`,
  mensaje: `${pedido.destino} · ${pedido.cliente}: avisa al cliente o prepara el despacho`,
  roles: ['cajero', 'administrador'],
  nivel: 'exito',
  datos: { numero: pedido.numero }
}));


/* ---------- Inventario ---------- */

// Revisa los productos de un pedido recién hecho y avisa al administrador si alguno quedó con poco stock
export async function alertarStockBajo(db, idsProductos) {
  try {
    const ids = [...new Set(idsProductos)];
    if (!ids.length) return;

    const binds = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
    const marcadores = ids.map((_, i) => `:id${i}`).join(', ');   // solo ":id0, :id1..." generado por el código

    const { rows } = await db.ejecutar(`
      /* productos_stock_bajo */
      SELECT id_producto, nombre, stock FROM producto
       WHERE id_producto IN (${marcadores}) AND stock <= :umbral`, { ...binds, umbral: UMBRAL_STOCK_BAJO });

    for (const r of rows) {
      const agotado = r.STOCK <= 0;

      publicar({
        tipo: agotado ? 'stock_agotado' : 'stock_bajo',
        titulo: agotado ? `${r.NOMBRE} se agotó` : `Poco stock de ${r.NOMBRE}`,
        mensaje: agotado ? 'Ya no se puede pedir hasta reponerlo.' : `Quedan ${r.STOCK} unidades.`,
        roles: ['administrador'],
        nivel: agotado ? 'alerta' : 'aviso',
        datos: { idProducto: r.ID_PRODUCTO, stock: r.STOCK }
      });
    }
  } catch (error) {
    logger.error('alerta_stock_fallida', { motivo: error.message });
  }
}


/* ---------- Pagos ---------- */

export const alertarPago = (pago) => seguro(() => {
  const aprobado = pago.estado === 'AUTORIZADO';
  const anulado = pago.estado === 'ANULADO';

  publicar({
    tipo: aprobado ? 'pago_aprobado' : anulado ? 'pago_anulado' : 'pago_rechazado',
    titulo: aprobado ? `Pago aprobado · pedido ${numeroPedido(pago.idPedido)}`
      : anulado ? `Pago anulado · pedido ${numeroPedido(pago.idPedido)}`
        : `Pago no completado · pedido ${numeroPedido(pago.idPedido)}`,
    mensaje: `${pesos(pago.monto)} · ${pago.metodo === 'EFECTIVO' ? 'efectivo' : 'tarjeta'}`,
    roles: ['administrador'],
    usuarioId: pago.idUsuario ?? undefined,       // también a quien inició el cobro
    nivel: aprobado ? 'exito' : 'alerta',
    datos: { idPedido: pago.idPedido, idPago: pago.id }
  });
});


/* ---------- Administración ---------- */

export const alertarFalloGrave = (reporte) => seguro(() => publicar({
  tipo: 'fallo_reportado',
  titulo: 'Fallo grave reportado',
  mensaje: `${reporte.usuario}: ${reporte.titulo}`,
  roles: ['administrador'],
  nivel: 'alerta',
  datos: { idFeedback: reporte.id }
}));

export const alertarRespaldoFallido = (motivo) => seguro(() => publicar({
  tipo: 'respaldo_fallido',
  titulo: 'Falló el respaldo automático',
  mensaje: String(motivo).slice(0, 200),
  roles: ['administrador'],
  nivel: 'alerta'
}));
