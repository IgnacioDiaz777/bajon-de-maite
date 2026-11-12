import { Joi, validar } from './validar.js';

const perfilSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).required()
    .messages({ 'string.empty': 'El nombre es obligatorio.', 'any.required': 'El nombre es obligatorio.', 'string.min': 'El nombre debe tener al menos 2 caracteres.' })
});

// Misma regla que al registrar usuarios: mínimo 8, con letras y números
const claveSchema = Joi.object({
  claveActual: Joi.string().max(128).required()
    .messages({ 'string.empty': 'Escribe tu contraseña actual.', 'any.required': 'Escribe tu contraseña actual.' }),

  claveNueva: Joi.string().min(8).max(128).pattern(/[A-Za-z]/).pattern(/\d/).required()
    .messages({
      'string.min': 'La contraseña nueva debe tener al menos 8 caracteres.',
      'string.pattern.base': 'La contraseña nueva debe incluir letras y números.',
      'string.empty': 'Escribe la contraseña nueva.',
      'any.required': 'Escribe la contraseña nueva.'
    })
});

export const validatePerfil = validar(perfilSchema);
export const validateClave = validar(claveSchema);
