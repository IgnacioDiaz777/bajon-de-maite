import { Joi, validar, validarConsulta } from './validar.js';

// Perfil del cliente (POST y PUT /api/clientes)
const clienteSchema = Joi.object({
  nombre: Joi.string().trim().min(2).max(40).required()
    .messages({
      'string.empty': 'El nombre del cliente es obligatorio.',
      'any.required': 'El nombre del cliente es obligatorio.',
      'string.min': 'El nombre debe tener al menos 2 caracteres.',
      'string.max': 'El nombre no puede superar los 40 caracteres.'
    }),

  // Teléfono chileno o internacional: dígitos, espacios, + y guiones (7 a 20 caracteres)
  telefono: Joi.string().trim().pattern(/^\+?[0-9][0-9 -]{5,18}[0-9]$/).allow('', null)
    .messages({ 'string.pattern.base': 'El teléfono debe tener entre 7 y 20 dígitos (puede llevar +, espacios o guiones).' }),

  email: Joi.string().trim().max(100).email({ tlds: { allow: false } }).allow('', null)
    .messages({ 'string.email': 'El correo no es válido.' }),

  notas: Joi.string().trim().max(300).allow('', null)
});

// Dirección de despacho (POST y PUT /api/clientes/:id/direcciones)
const direccionSchema = Joi.object({
  alias: Joi.string().trim().min(2).max(30).required()
    .messages({ 'string.empty': 'Ponle un nombre a la dirección (ej: Casa, Trabajo).', 'any.required': 'Ponle un nombre a la dirección (ej: Casa, Trabajo).' }),

  calle: Joi.string().trim().min(2).max(80).required()
    .messages({ 'string.empty': 'La calle es obligatoria.', 'any.required': 'La calle es obligatoria.' }),

  numero: Joi.string().trim().max(15).required()
    .messages({ 'string.empty': 'El número es obligatorio (usa S/N si no tiene).', 'any.required': 'El número es obligatorio (usa S/N si no tiene).' }),

  depto: Joi.string().trim().max(20).allow('', null),

  comuna: Joi.string().trim().min(2).max(40).required()
    .messages({ 'string.empty': 'La comuna es obligatoria.', 'any.required': 'La comuna es obligatoria.' }),

  ciudad: Joi.string().trim().min(2).max(40).default('Santiago'),

  referencia: Joi.string().trim().max(150).allow('', null),

  esPrincipal: Joi.boolean().default(false)
});

// Búsqueda de clientes (GET /api/clientes?buscar=ana)
const filtrosSchema = Joi.object({
  buscar: Joi.string().trim().max(40).allow(''),
  limite: Joi.number().integer().min(1).max(200).default(50)
});

export const validateCliente = validar(clienteSchema);
export const validateDireccion = validar(direccionSchema);
export const validateClienteFiltros = validarConsulta(filtrosSchema);
