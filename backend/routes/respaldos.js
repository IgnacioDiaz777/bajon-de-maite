import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { validateRestaurar } from '../validators/respaldoValidator.js';
import { listarRespaldos, crearRespaldo, restaurarRespaldo } from '../services/backupService.js';


export function rutasRespaldos(db) {
  const router = Router();

  // Respaldos disponibles (el más nuevo primero)
  router.get('/', autenticar, exigirRol('administrador'), async (req, res) => {
    res.json({ status: 'success', data: await listarRespaldos() });
  });

  // Crear un respaldo ahora
  router.post('/', autenticar,
    auditar(db, {
      accion: 'RESPALDO_CREAR',
      entidad: 'RESPALDO',
      idEntidad: (req, cuerpo) => cuerpo.data && cuerpo.data.archivo
    }),
    exigirRol('administrador'),
    async (req, res) => {
      const respaldo = await crearRespaldo(db);
      res.status(201).json({ status: 'success', message: 'Respaldo creado.', data: respaldo });
    });

  // Restaurar un respaldo (reemplaza los datos del negocio; antes guarda un respaldo de seguridad)
  router.post('/restaurar', autenticar,
    auditar(db, {
      accion: 'RESPALDO_RESTAURAR',
      entidad: 'RESPALDO',
      idEntidad: (req) => req.body && req.body.archivo,
      detalle: (req, cuerpo) => `Seguridad previa: ${cuerpo.data.respaldoDeSeguridad}`
    }),
    exigirRol('administrador'), validateRestaurar,
    async (req, res) => {
      const resultado = await restaurarRespaldo(db, req.body.archivo);
      res.json({ status: 'success', message: 'Respaldo restaurado.', data: resultado });
    });

  return router;
}
