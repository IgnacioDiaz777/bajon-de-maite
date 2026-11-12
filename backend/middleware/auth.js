/* ==========================================================
   AUTENTICACIÓN Y ROLES (JWT)
   ========================================================== */

import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { logger } from '../services/logger.js';


export function autenticar(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  try {
    req.usuario = jwt.verify(token, config.jwtSecreto);
    next();
  } catch {
    res.status(401).json({ status: 'error', errors: ['Debes iniciar sesión para continuar.'] });
  }
}

export const exigirRol = (...rolesPermitidos) => (req, res, next) => {
  if (!rolesPermitidos.includes(req.usuario.rol)) {
    logger.warn('acceso_denegado', { usuario: req.usuario.usuario, rol: req.usuario.rol, ruta: `${req.method} ${req.originalUrl}` });
    return res.status(403).json({ status: 'error', errors: ['No tienes permisos para realizar esta acción.'] });
  }

  next();
};
