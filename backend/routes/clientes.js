import { Router } from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { ErrorApp } from '../services/errores.js';
import { validateCliente, validateDireccion, validateClienteFiltros } from '../validators/clienteValidator.js';
import {
  listarClientes, obtenerCliente, crearCliente, actualizarCliente, desactivarCliente,
  crearDireccion, actualizarDireccion, eliminarDireccion
} from '../services/clienteService.js';


const leerId = (valor, texto) => {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, `El id ${texto} no es válido.`);
  return id;
};


export function rutasClientes(db) {
  const router = Router();

  const atiende = exigirRol('administrador', 'cajero');       // el cocinero no gestiona clientes

  router.get('/', autenticar, atiende, validateClienteFiltros, async (req, res) => {
    res.json({ status: 'success', data: await listarClientes(db, req.consulta) });
  });

  router.get('/:id', autenticar, atiende, async (req, res) => {
    res.json({ status: 'success', data: await obtenerCliente(db, leerId(req.params.id, 'del cliente')) });
  });

  router.post('/', autenticar,
    auditar(db, { accion: 'CLIENTE_CREAR', entidad: 'CLIENTE', idEntidad: (req, c) => c.data && c.data.id, detalle: (req) => req.body.nombre }),
    atiende, validateCliente,
    async (req, res) => {
      res.status(201).json({ status: 'success', message: 'Cliente registrado.', data: await crearCliente(db, req.body) });
    });

  router.put('/:id', autenticar,
    auditar(db, { accion: 'CLIENTE_EDITAR', entidad: 'CLIENTE', idEntidad: (req) => req.params.id, detalle: (req) => req.body.nombre }),
    atiende, validateCliente,
    async (req, res) => {
      res.json({ status: 'success', message: 'Cliente actualizado.', data: await actualizarCliente(db, leerId(req.params.id, 'del cliente'), req.body) });
    });

  router.delete('/:id', autenticar,
    auditar(db, { accion: 'CLIENTE_ELIMINAR', entidad: 'CLIENTE', idEntidad: (req) => req.params.id }),
    exigirRol('administrador'),
    async (req, res) => {
      await desactivarCliente(db, leerId(req.params.id, 'del cliente'));
      res.json({ status: 'success', message: 'Cliente eliminado.' });
    });


  /* ----- Direcciones de despacho ----- */

  router.post('/:id/direcciones', autenticar,
    auditar(db, { accion: 'DIRECCION_CREAR', entidad: 'CLIENTE', idEntidad: (req) => req.params.id, detalle: (req) => `${req.body.calle} ${req.body.numero}, ${req.body.comuna}` }),
    atiende, validateDireccion,
    async (req, res) => {
      const direccion = await crearDireccion(db, leerId(req.params.id, 'del cliente'), req.body);
      res.status(201).json({ status: 'success', message: 'Dirección agregada.', data: direccion });
    });

  router.put('/:id/direcciones/:idDireccion', autenticar,
    auditar(db, { accion: 'DIRECCION_EDITAR', entidad: 'CLIENTE', idEntidad: (req) => req.params.id, detalle: (req) => `Dirección ${req.params.idDireccion}` }),
    atiende, validateDireccion,
    async (req, res) => {
      const direccion = await actualizarDireccion(db, leerId(req.params.id, 'del cliente'), leerId(req.params.idDireccion, 'de la dirección'), req.body);
      res.json({ status: 'success', message: 'Dirección actualizada.', data: direccion });
    });

  router.delete('/:id/direcciones/:idDireccion', autenticar,
    auditar(db, { accion: 'DIRECCION_ELIMINAR', entidad: 'CLIENTE', idEntidad: (req) => req.params.id, detalle: (req) => `Dirección ${req.params.idDireccion}` }),
    atiende,
    async (req, res) => {
      await eliminarDireccion(db, leerId(req.params.id, 'del cliente'), leerId(req.params.idDireccion, 'de la dirección'));
      res.json({ status: 'success', message: 'Dirección eliminada.' });
    });

  return router;
}
