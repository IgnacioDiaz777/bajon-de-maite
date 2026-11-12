import { Joi, validar, validarConsulta } from './validar.js';

// Esquema para enviar un comentario, sugerencia o reporte de fallo (POST /api/feedback)
const feedbackSchema = Joi.object({
  tipo: Joi.string()
    .valid('FALLO', 'SUGERENCIA', 'COMENTARIO')
    .required()
    .messages({
      'any.only': 'El tipo debe ser FALLO, SUGERENCIA o COMENTARIO.',
      'any.required': 'Indica qué tipo de reporte es.'
    }),

  // Solo se usa cuando el tipo es FALLO
  gravedad: Joi.string()
    .valid('BAJA', 'MEDIA', 'ALTA')
    .default('MEDIA')
    .messages({ 'any.only': 'La gravedad debe ser BAJA, MEDIA o ALTA.' }),

  titulo: Joi.string()
    .trim()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Escribe un título corto.',
      'any.required': 'Escribe un título corto.',
      'string.min': 'El título debe tener al menos 3 caracteres.',
      'string.max': 'El título no puede superar los 100 caracteres.'
    }),

  descripcion: Joi.string()
    .trim()
    .min(5)
    .max(1000)
    .required()
    .messages({
      'string.empty': 'Cuéntanos qué pasó.',
      'any.required': 'Cuéntanos qué pasó.',
      'string.min': 'La descripción debe tener al menos 5 caracteres.',
      'string.max': 'La descripción no puede superar los 1000 caracteres.'
    }),

  // Pantalla donde estaba la persona (inicio, productos, pedidos...)
  pantalla: Joi.string().trim().max(30).allow('', null),

  origen: Joi.string().valid('MANUAL', 'AUTOMATICO').default('MANUAL')
});

// Cambio de estado de un reporte (solo administrador)
const estadoSchema = Joi.object({
  estado: Joi.string()
    .valid('ABIERTO', 'EN_REVISION', 'RESUELTO')
    .required()
    .messages({ 'any.only': 'El estado debe ser ABIERTO, EN_REVISION o RESUELTO.' })
});

// Filtros del listado (GET /api/feedback?estado=ABIERTO&tipo=FALLO)
const filtrosSchema = Joi.object({
  estado: Joi.string().valid('ABIERTO', 'EN_REVISION', 'RESUELTO'),
  tipo: Joi.string().valid('FALLO', 'SUGERENCIA', 'COMENTARIO'),
  limite: Joi.number().integer().min(1).max(500).default(100)
});

export const validateFeedback = validar(feedbackSchema);
export const validateFeedbackEstado = validar(estadoSchema);
export const validateFeedbackFiltros = validarConsulta(filtrosSchema);
