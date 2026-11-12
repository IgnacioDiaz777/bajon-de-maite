import { Joi, validar } from './validar.js';

// Restaurar es destructivo: hay que enviar el nombre del archivo Y la palabra de confirmación
const restaurarSchema = Joi.object({
  archivo: Joi.string()
    .pattern(/^(respaldo|seguridad)-\d{8}-\d{6}(-\d+)?\.json$/)
    .required()
    .messages({
      'string.pattern.base': 'El nombre del archivo de respaldo no es válido.',
      'any.required': 'Indica qué respaldo quieres restaurar.'
    }),

  confirmar: Joi.string()
    .valid('RESTAURAR')
    .required()
    .messages({
      'any.only': 'Para restaurar debes confirmar escribiendo RESTAURAR.',
      'any.required': 'Para restaurar debes confirmar escribiendo RESTAURAR.'
    })
});

export const validateRestaurar = validar(restaurarSchema);
