/* ==========================================================
   PEDIDOS
   Tablas: PEDIDO, DETALLE_PEDIDO, CLIENTE, PRODUCTO.
   El pedido se crea con el procedimiento SP_CREAR_PEDIDO
   (inserta el detalle, calcula el total y descuenta el stock).

   Como PEDIDO no tiene columna para "Mesa / Para llevar",
   ese dato se guarda al inicio de OBSERVACIONES: "[Mesa 03] nota".
   ========================================================== */

import { ErrorApp, primerValor } from './errores.js';


// Recargo por convertir un plato en combo (papas + bebida). Se guarda
// en PRECIO_UNITARIO del detalle, por eso el servidor lo calcula.
export const RECARGO_COMBO = 2000;

const ESTADOS_ACTIVOS = "('PENDIENTE', 'EN_PREPARACION', 'LISTO')";

const TEXTO_ESTADO = {
  PENDIENTE: 'En preparación',
  EN_PREPARACION: 'En preparación',
  LISTO: 'Listo para retirar',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado'
};

// Qué estado sigue y qué roles pueden hacer el cambio
const TRANSICIONES = {
  PENDIENTE: { siguiente: 'LISTO', roles: ['administrador', 'cocinero'] },
  EN_PREPARACION: { siguiente: 'LISTO', roles: ['administrador', 'cocinero'] },
  LISTO: { siguiente: 'ENTREGADO', roles: ['administrador', 'cajero'] }
};


/* ---------- Lectura ---------- */

const SELECT_PEDIDOS = `
  SELECT p.id_pedido, p.fecha, p.estado, p.total, p.observaciones, c.nombre AS cliente,
         d.cantidad, d.precio_unitario, pr.nombre AS producto, pr.precio AS precio_base
    FROM pedido p
    JOIN cliente c         ON c.id_cliente  = p.id_cliente
    JOIN detalle_pedido d  ON d.id_pedido   = p.id_pedido
    JOIN producto pr       ON pr.id_producto = d.id_producto`;

function agruparPedidos(filas) {
  const pedidos = new Map();

  for (const r of filas) {
    if (!pedidos.has(r.ID_PEDIDO)) {
      const coincidencia = /^\[([^\]]+)\]\s?([\s\S]*)$/.exec(r.OBSERVACIONES || '');

      pedidos.set(r.ID_PEDIDO, {
        numero: r.ID_PEDIDO,
        cliente: r.CLIENTE,
        destino: coincidencia ? coincidencia[1] : 'Para llevar',
        nota: coincidencia ? coincidencia[2] : (r.OBSERVACIONES || ''),
        estado: TEXTO_ESTADO[r.ESTADO] || r.ESTADO,
        fecha: r.FECHA,
        total: r.TOTAL,
        items: []
      });
    }

    const esCombo = r.PRECIO_UNITARIO > r.PRECIO_BASE;

    pedidos.get(r.ID_PEDIDO).items.push({
      nombre: r.PRODUCTO + (esCombo ? ' (combo)' : ''),
      cantidad: r.CANTIDAD
    });
  }

  return [...pedidos.values()];
}


export async function listarPedidosActivos(db) {
  const { rows } = await db.ejecutar(`
    /* pedidos_activos */
    ${SELECT_PEDIDOS}
   WHERE p.id_pedido IN (
           SELECT id_pedido FROM (
             SELECT id_pedido FROM pedido
              WHERE estado IN ${ESTADOS_ACTIVOS}
              ORDER BY fecha DESC, id_pedido DESC
              FETCH FIRST 50 ROWS ONLY))
   ORDER BY p.fecha DESC, p.id_pedido DESC, d.id_detalle`);

  return agruparPedidos(rows);
}


async function obtenerPedido(db, id) {
  const { rows } = await db.ejecutar(`
    /* pedido_por_id */
    ${SELECT_PEDIDOS}
   WHERE p.id_pedido = :id
   ORDER BY d.id_detalle`, { id });

  return agruparPedidos(rows)[0] || null;
}


/* ---------- Creación ---------- */

export async function crearPedido(db, { nombreCliente, tipoEntrega, notaCocinero, productos }) {
  const nombre = nombreCliente.trim();
  const nota = (notaCocinero || '').trim();

  // 1. Juntar líneas repetidas (mismo producto y mismo tipo)
  const lineas = new Map();

  for (const item of productos) {
    const combo = Boolean(item.combo);
    const clave = `${item.productoId}|${combo}`;
    const existente = lineas.get(clave);

    if (existente) existente.cantidad += item.cantidad;
    else lineas.set(clave, { idProducto: item.productoId, cantidad: item.cantidad, combo });
  }

  // 2. Leer los productos reales (precio y stock salen de la base de datos, no del navegador)
  const ids = [...new Set([...lineas.values()].map((l) => l.idProducto))];
  const binds = Object.fromEntries(ids.map((id, i) => [`id${i}`, id]));
  const marcadores = ids.map((_, i) => `:id${i}`).join(', ');   // solo ":id0, :id1..." generado por el código

  const { rows } = await db.ejecutar(`
    /* productos_por_ids */
    SELECT id_producto, nombre, precio, stock, categoria
      FROM producto
     WHERE id_producto IN (${marcadores})`, binds);

  const catalogo = new Map(rows.map((r) => [r.ID_PRODUCTO, r]));

  // 3. Validar existencia, combos y stock
  const pedidoPorProducto = new Map();

  for (const linea of lineas.values()) {
    const producto = catalogo.get(linea.idProducto);

    if (!producto) throw new ErrorApp(400, `El producto ${linea.idProducto} no existe.`);
    if (linea.combo && producto.CATEGORIA !== 'COMIDA') {
      throw new ErrorApp(400, `"${producto.NOMBRE}" no se puede pedir como combo.`);
    }

    pedidoPorProducto.set(linea.idProducto, (pedidoPorProducto.get(linea.idProducto) || 0) + linea.cantidad);
  }

  for (const [idProducto, cantidad] of pedidoPorProducto) {
    const producto = catalogo.get(idProducto);

    if (producto.STOCK <= 0) throw new ErrorApp(409, `"${producto.NOMBRE}" está agotado.`);
    if (cantidad > producto.STOCK) {
      throw new ErrorApp(409, `No hay stock suficiente de "${producto.NOMBRE}" (quedan ${producto.STOCK}).`);
    }
  }

  const filasItems = [...lineas.values()].map((l) => ({
    ID_PRODUCTO: l.idProducto,
    CANTIDAD: l.cantidad,
    PRECIO_UNITARIO: catalogo.get(l.idProducto).PRECIO + (l.combo ? RECARGO_COMBO : 0)
  }));

  const observaciones = `[${tipoEntrega}]${nota ? ' ' + nota : ''}`;

  // 4. Registrar: cliente → SP_CREAR_PEDIDO → estado "en preparación"
  const idPedido = await db.sesion(async (s) => {
    const buscado = await s.ejecutar(`
      /* cliente_buscar */
      SELECT id_cliente FROM cliente
       WHERE LOWER(nombre) = LOWER(:nombre) AND activo = 1
       FETCH FIRST 1 ROWS ONLY`, { nombre });

    let idCliente = buscado.rows[0] && buscado.rows[0].ID_CLIENTE;

    if (!idCliente) {
      const nuevo = await s.ejecutar(`
        /* cliente_crear */
        INSERT INTO cliente (nombre) VALUES (:nombre)
        RETURNING id_cliente INTO :id`, { nombre, id: s.salidaNumero });

      idCliente = primerValor(nuevo.outBinds.id);
      await s.commit(); // el procedimiento hace su propio COMMIT / ROLLBACK
    }

    try {
      const lista = await s.listaDe('T_LISTA_ITEMS', filasItems);

      const resultado = await s.ejecutar(`
        /* sp_crear_pedido */
        BEGIN
          sp_crear_pedido(:id_cliente, :observacion, :items, :id_pedido);
        END;`,
        { id_cliente: idCliente, observacion: observaciones, items: lista, id_pedido: s.salidaNumero });

      const id = primerValor(resultado.outBinds.id_pedido);

      // El procedimiento deja el pedido como PENDIENTE; al enviarlo a cocina pasa a EN_PREPARACION
      await s.ejecutar(`/* pedido_a_preparacion */ UPDATE pedido SET estado = 'EN_PREPARACION' WHERE id_pedido = :id`, { id });

      return id;
    } catch (error) {
      // El procedimiento convierte sus errores en ORA-20001; el stock se protege con CHK_STOCK_PROD
      if (/CHK_STOCK_PROD|ORA-02290/.test(String(error.message))) {
        throw new ErrorApp(409, 'No hay stock suficiente para completar el pedido.');
      }

      throw error;
    }
  });

  return obtenerPedido(db, idPedido);
}


/* ---------- Seguimiento ---------- */

export async function avanzarPedido(db, id, rol) {
  const { rows } = await db.ejecutar(`/* pedido_estado */ SELECT estado FROM pedido WHERE id_pedido = :id`, { id });

  if (!rows.length) throw new ErrorApp(404, 'El pedido no existe.');

  const actual = rows[0].ESTADO;
  const transicion = TRANSICIONES[actual];

  if (!transicion) throw new ErrorApp(409, `El pedido ya está ${TEXTO_ESTADO[actual].toLowerCase()}.`);
  if (!transicion.roles.includes(rol)) throw new ErrorApp(403, 'Tu rol no puede realizar este cambio de estado.');

  // "AND estado = :actual" evita pisar un cambio hecho al mismo tiempo por otra persona
  const resultado = await db.ejecutar(`
    /* pedido_cambiar_estado */
    UPDATE pedido SET estado = :nuevo WHERE id_pedido = :id AND estado = :actual`,
    { nuevo: transicion.siguiente, id, actual });

  if (!resultado.rowsAffected) throw new ErrorApp(409, 'El pedido cambió de estado. Actualiza la lista.');

  return obtenerPedido(db, id);
}
