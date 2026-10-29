import { Joi, validar } from './validar.js';

// USUARIO guarda NOMBRE_USUARIO (no un correo), por eso el login usa "usuario"
const loginSchema = Joi.object({
  usuario: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .required()
    .messages({
      'string.empty': 'El usuario es obligatorio.',
      'any.required': 'El usuario es obligatorio.',
      'string.min': 'El usuario debe tener al menos 3 caracteres.'
    }),
  password: Joi.string()
    .max(128)
    .required()
    .messages({
      'string.empty': 'La contraseña es obligatoria.',
      'any.required': 'La contraseña es obligatoria.'
    })
});

export const validateLogin = validar(loginSchema);
