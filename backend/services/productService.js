/* ==========================================================
   PRODUCTOS
   Tabla PRODUCTO: id_producto, nombre, descripcion, precio,
   stock, categoria (COMIDA | BEBIDA | POSTRE | OTRO).
   ========================================================== */

import { ErrorApp, primerValor } from './errores.js';


const aProducto = (r) => ({
  id: r.ID_PRODUCTO,
  nombre: r.NOMBRE,
  descripcion: r.DESCRIPCION || '',
  precio: r.PRECIO,
  stock: r.STOCK,
  categoria: r.CATEGORIA
});


export async function listarProductos(db) {
  const { rows } = await db.ejecutar(`
    /* productos_listar */
    SELECT id_producto, nombre, descripcion, precio, stock, categoria
      FROM producto
     ORDER BY id_producto DESC`);

  return rows.map(aProducto);
}


async function verificarNombreLibre(db, nombre, idActual = 0) {
  const { rows } = await db.ejecutar(`
    /* producto_nombre_duplicado */
    SELECT id_producto FROM producto
     WHERE LOWER(nombre) = LOWER(:nombre) AND id_producto <> :id`, { nombre, id: idActual });

  if (rows.length) throw new ErrorApp(409, 'Ya existe un producto con ese nombre.');
}


export async function crearProducto(db, datos) {
  await verificarNombreLibre(db, datos.nombre);

  const resultado = await db.ejecutar(`
    /* producto_crear */
    INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
    VALUES (:nombre, :descripcion, :precio, :stock, :categoria)
    RETURNING id_producto INTO :id`,
    {
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      precio: datos.precio,
      stock: datos.stock,
      categoria: datos.categoria,
      id: db.salidaNumero
    });

  return { id: primerValor(resultado.outBinds.id), ...datos, descripcion: datos.descripcion || '' };
}


export async function actualizarProducto(db, id, datos) {
  await verificarNombreLibre(db, datos.nombre, id);

  const resultado = await db.ejecutar(`
    /* producto_actualizar */
    UPDATE producto
       SET nombre = :nombre, descripcion = :descripcion, precio = :precio,
           stock = :stock, categoria = :categoria
     WHERE id_producto = :id`,
    {
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      precio: datos.precio,
      stock: datos.stock,
      categoria: datos.categoria,
      id
    });

  if (!resultado.rowsAffected) throw new ErrorApp(404, 'El producto no existe.');

  return { id, ...datos, descripcion: datos.descripcion || '' };
}


export async function eliminarProducto(db, id) {
  try {
    const resultado = await db.ejecutar(`/* producto_eliminar */ DELETE FROM producto WHERE id_producto = :id`, { id });

    if (!resultado.rowsAffected) throw new ErrorApp(404, 'El producto no existe.');
  } catch (error) {
    // ORA-02292: el producto ya está en pedidos (FK_DETALLE_PRODUCTO)
    if (error.errorNum === 2292) {
      throw new ErrorApp(409, 'No se puede eliminar: el producto ya está en pedidos. Déjalo con stock 0 para que figure como agotado.');
    }

    throw error;
  }
}
