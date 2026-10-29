import { Joi, validar } from './validar.js';

// Esquema para crear o editar un plato (usado en POST y PUT /api/productos)
// El estado (Disponible / Pocas unidades / Agotado) se deduce del stock, no se envía.
const productSchema = Joi.object({
  nombre: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .required()
    .messages({
      'string.empty': 'El nombre del producto no puede estar vacío.',
      'string.min': 'El nombre debe tener al menos 3 caracteres.'
    }),

  descripcion: Joi.string()
    .trim()
    .max(150)
    .allow('', null), // Opcional (ej: "Cheddar + tocino crujiente")

  precio: Joi.number()
    .integer() // En CLP usamos enteros (ej: 6990, 3990)
    .min(100)  // Precio mínimo lógico para comida rápida
    .max(9999999)
    .required()
    .messages({
      'number.base': 'El precio debe ser un número.',
      'number.min': 'El precio debe ser un monto válido en pesos.'
    }),

  stock: Joi.number()
    .integer()
    .min(0)
    .max(999999)
    .required()
    .messages({
      'number.min': 'El stock no puede ser negativo.'
    }),

  // Valores permitidos por la restricción CHK_CAT_PROD de la base de datos
  categoria: Joi.string()
    .valid('COMIDA', 'BEBIDA', 'POSTRE', 'OTRO')
    .required()
    .messages({
      'any.only': 'La categoría debe ser COMIDA, BEBIDA, POSTRE u OTRO.'
    })
});

export const validateProduct = validar(productSchema);
