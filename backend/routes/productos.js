import { Router } from 'express';
import { validateProduct } from '../validators/productValidator.js';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { ErrorApp } from '../services/errores.js';
import { listarProductos, crearProducto, actualizarProducto, eliminarProducto } from '../services/productService.js';


function leerId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'El id del producto no es válido.');
  return id;
}


export function rutasProductos(db) {
  const router = Router();

  // Todos los roles pueden ver el menú
  router.get('/', autenticar, async (req, res) => {
    res.json({ status: 'success', data: await listarProductos(db) });
  });

  // Solo el administrador gestiona el menú
  router.post('/', autenticar, exigirRol('administrador'), validateProduct, async (req, res) => {
    const producto = await crearProducto(db, req.body);
    res.status(201).json({ status: 'success', message: '¡Producto creado con éxito!', data: producto });
  });

  router.put('/:id', autenticar, exigirRol('administrador'), validateProduct, async (req, res) => {
    const producto = await actualizarProducto(db, leerId(req), req.body);
    res.json({ status: 'success', message: 'Producto actualizado.', data: producto });
  });

  router.delete('/:id', autenticar, exigirRol('administrador'), async (req, res) => {
    await eliminarProducto(db, leerId(req));
    res.json({ status: 'success', message: 'Producto eliminado.' });
  });

  return router;
}
