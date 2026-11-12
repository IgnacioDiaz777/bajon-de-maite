import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { autenticar } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { validatePerfil, validateClave } from '../validators/perfilValidator.js';
import { actualizarNombre, cambiarClave } from '../services/perfilService.js';


export function rutasPerfil(db) {
  const router = Router();

  // Datos de quien tiene la sesión (el rol sale del token, que firmó el servidor)
  router.get('/', autenticar, (req, res) => {
    const { id, nombre, usuario, iniciales, rol } = req.usuario;
    res.json({ status: 'success', data: { id, nombre, usuario, iniciales, rol } });
  });

  router.put('/', autenticar,
    auditar(db, { accion: 'PERFIL_EDITAR', entidad: 'USUARIO', idEntidad: (req) => req.usuario.id, detalle: (req) => `Nuevo nombre: ${req.body.nombre}` }),
    validatePerfil,
    async (req, res) => {
      const usuario = await actualizarNombre(db, req.usuario, req.body.nombre);

      // Token nuevo para que el nombre y las iniciales de la sesión queden al día
      const token = jwt.sign(usuario, config.jwtSecreto, { expiresIn: config.jwtExpira });
      res.json({ status: 'success', message: 'Perfil actualizado.', data: usuario, token });
    });

  // Nunca se registra ninguna de las dos contraseñas
  router.put('/clave', autenticar,
    auditar(db, { accion: 'CLAVE_CAMBIAR', entidad: 'USUARIO', idEntidad: (req) => req.usuario.id }),
    validateClave,
    async (req, res) => {
      await cambiarClave(db, req.usuario, req.body);
      res.json({ status: 'success', message: 'Contraseña actualizada.' });
    });

  return router;
}
