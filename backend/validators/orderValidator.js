import { Joi, validar } from './validar.js';

// Esquema de validación para un Nuevo Pedido
const orderSchema = Joi.object({
  nombreCliente: Joi.string()
    .trim()
    .min(2)
    .max(40)
    .required()
    .messages({
      'string.empty': 'Debes ingresar el nombre del cliente para la orden.',
      'string.min': 'El nombre del cliente debe tener al menos 2 caracteres.'
    }),

  tipoEntrega: Joi.string()
    .valid('Para llevar', 'Mesa 01', 'Mesa 02', 'Mesa 03', 'Mesa 04', 'Mesa 05') // Mismas opciones que el selector de la app
    .required()
    .messages({
      'any.only': 'El tipo de entrega seleccionado no es válido.'
    }),

  notaCocinero: Joi.string()
    .trim()
    .max(200)
    .allow('', null), // Opcional (ej: "pan fresco y crujiente de acompañamiento")

  // Validación crítica: La lista de items del carrito
  productos: Joi.array()
    .items(
      Joi.object({
        productoId: Joi.number().integer().positive().required(), // ID_PRODUCTO de la tabla PRODUCTO
        cantidad: Joi.number().integer().min(1).max(100).required().messages({
          'number.min': 'La cantidad mínima por producto es 1.'
        }),
        combo: Joi.boolean().default(false)
      })
    )
    .min(1) // Evita que se envíen pedidos con 0 productos
    .max(30)
    .required()
    .messages({
      'array.min': 'Debes añadir al menos un producto al pedido.'
    })
});

export const validateOrder = validar(orderSchema);
