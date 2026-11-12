import { Joi, validarConsulta } from './validar.js';

const fecha = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({ 'string.pattern.base': 'Las fechas deben tener el formato AAAA-MM-DD.' });

// GET /api/analitica/ventas?desde=2026-11-01&hasta=2026-11-10  (sin fechas: los últimos 7 días)
const ventasSchema = Joi.object({ desde: fecha, hasta: fecha });

export const validateAnaliticaVentas = validarConsulta(ventasSchema);
