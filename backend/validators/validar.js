import Joi from 'joi';

/* Crea un middleware que valida req.body con un esquema Joi.
   Mantiene el formato de error del equipo: { status: 'error', errors: [...] } */
export const validar = (esquema) => (req, res, next) => {
  const { error, value } = esquema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      status: 'error',
      errors: error.details.map((detalle) => detalle.message)
    });
  }

  req.body = value; // valores ya limpios (sin espacios sobrantes, números convertidos)
  next();
};

/* Igual que validar(), pero para los filtros de la URL (?estado=ABIERTO&limite=50).
   Los valores limpios quedan en req.consulta (req.query no se puede modificar en Express 5). */
export const validarConsulta = (esquema) => (req, res, next) => {
  const { error, value } = esquema.validate(req.query, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      status: 'error',
      errors: error.details.map((detalle) => detalle.message)
    });
  }

  req.consulta = value;
  next();
};

export { Joi };
