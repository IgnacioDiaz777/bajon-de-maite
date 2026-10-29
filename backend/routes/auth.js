import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { validateLogin } from '../validators/authValidator.js';
import { autenticar } from '../middleware/auth.js';
import { autenticarUsuario } from '../services/authService.js';


export function rutasAuth(db) {
  const router = Router();

  // POST /api/auth/login → valida contra la tabla USUARIO y entrega un token JWT
  router.post('/login', validateLogin, async (req, res) => {
    const usuario = await autenticarUsuario(db, req.body);

    const token = jwt.sign(usuario, config.jwtSecreto, { expiresIn: config.jwtExpira });

    res.status(200).json({ status: 'success', message: 'Autenticación exitosa', token, usuario });
  });

  // GET /api/auth/yo → datos del usuario con sesión
  router.get('/yo', autenticar, (req, res) => {
    const { id, nombre, usuario, iniciales, rol } = req.usuario;
    res.json({ status: 'success', usuario: { id, nombre, usuario, iniciales, rol } });
  });

  return router;
}
