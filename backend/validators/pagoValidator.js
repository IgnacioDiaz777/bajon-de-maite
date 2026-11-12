import { Joi, validar, validarConsulta } from './validar.js';

const idPedido = Joi.number().integer().positive().required()
  .messages({ 'any.required': 'Indica qué pedido quieres cobrar.', 'number.base': 'El pedido no es válido.' });

// POST /api/pagos/efectivo   (recibido es opcional: sirve para calcular el vuelto)
const efectivoSchema = Joi.object({
  idPedido,
  recibido: Joi.number().integer().min(0).max(100000000)
});

// POST /api/pagos/tarjeta
const tarjetaSchema = Joi.object({ idPedido });

// GET /api/pagos?pedidos=1,2,3
const pedidosSchema = Joi.object({
  pedidos: Joi.string().pattern(/^\d{1,9}(,\d{1,9}){0,99}$/).required()
    .messages({ 'string.pattern.base': 'La lista de pedidos no es válida.', 'any.required': 'Indica los pedidos.' })
});

// GET /api/pagos/historial
const historialSchema = Joi.object({
  estado: Joi.string().valid('CREADO', 'CONFIRMANDO', 'AUTORIZADO', 'RECHAZADO', 'ANULADO', 'EXPIRADO', 'ABANDONADO'),
  limite: Joi.number().integer().min(1).max(500).default(100)
});

export const validateEfectivo = validar(efectivoSchema);
export const validateTarjeta = validar(tarjetaSchema);
export const validatePedidosPago = validarConsulta(pedidosSchema);
export const validateHistorialPagos = validarConsulta(historialSchema);
