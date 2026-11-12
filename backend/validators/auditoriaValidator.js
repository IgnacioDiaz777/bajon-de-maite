import { Joi, validarConsulta } from './validar.js';

const fecha = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': 'Las fechas deben tener el formato AAAA-MM-DD.' });

// Filtros de GET /api/auditoria
const filtrosSchema = Joi.object({
  usuario: Joi.string().trim().max(50),
  accion: Joi.string().trim().pattern(/^[A-Z_]{3,40}$/).messages({ 'string.pattern.base': 'La acción no es válida.' }),
  resultado: Joi.string().valid('EXITO', 'FALLO'),
  desde: fecha,
  hasta: fecha,
  limite: Joi.number().integer().min(1).max(500).default(100)
});

export const validateAuditoriaFiltros = validarConsulta(filtrosSchema);
