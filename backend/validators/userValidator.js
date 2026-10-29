import { Joi, validar } from './validar.js';

// Esquema para registrar usuarios nuevos (solo el administrador)
const userSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(100).required()
    .messages({ 'string.empty': 'El nombre es obligatorio.', 'string.min': 'El nombre debe tener al menos 2 caracteres.' }),

  usuario: Joi.string().trim().pattern(/^[A-Za-z0-9._-]{3,50}$/).required()
    .messages({ 'string.pattern.base': 'El usuario debe tener 3 a 50 caracteres: letras, números, punto, guion o guion bajo.' }),

  password: Joi.string().min(8).max(128).pattern(/[A-Za-z]/).pattern(/\d/).required()
    .messages({
      'string.min': 'La contraseña debe tener al menos 8 caracteres.',
      'string.pattern.base': 'La contraseña debe incluir letras y números.'
    }),

  rol: Joi.string().valid('administrador', 'cajero', 'cocinero').required()
    .messages({ 'any.only': 'El rol debe ser administrador, cajero o cocinero.' })
});

export const validateUser = validar(userSchema);
