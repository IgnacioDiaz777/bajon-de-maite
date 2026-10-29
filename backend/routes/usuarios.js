import { Router } from 'express';
import { validateUser } from '../validators/userValidator.js';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { crearUsuario, listarUsuarios } from '../services/userService.js';


export function rutasUsuarios(db) {
  const router = Router();

  router.use(autenticar, exigirRol('administrador'));

  router.get('/', async (req, res) => {
    res.json({ status: 'success', data: await listarUsuarios(db) });
  });

  router.post('/', validateUser, async (req, res) => {
    const usuario = await crearUsuario(db, req.body);
    res.status(201).json({ status: 'success', message: 'Usuario registrado.', data: usuario });
  });

  return router;
}
