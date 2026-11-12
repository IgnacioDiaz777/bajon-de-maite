import { Router } from 'express';
import { validateUser } from '../validators/userValidator.js';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { crearUsuario, listarUsuarios } from '../services/userService.js';


export function rutasUsuarios(db) {
  const router = Router();

  router.use(autenticar);

  router.get('/', exigirRol('administrador'), async (req, res) => {
    res.json({ status: 'success', data: await listarUsuarios(db) });
  });

  router.post('/',
    auditar(db, {
      accion: 'USUARIO_CREAR',
      entidad: 'USUARIO',
      idEntidad: (req, cuerpo) => cuerpo.data && cuerpo.data.id,
      detalle: (req) => `Usuario ${req.body.usuario} · rol ${req.body.rol}`   // nunca la contraseña
    }),
    exigirRol('administrador'), validateUser,
    async (req, res) => {
      const usuario = await crearUsuario(db, req.body);
      res.status(201).json({ status: 'success', message: 'Usuario registrado.', data: usuario });
    });

  return router;
}
