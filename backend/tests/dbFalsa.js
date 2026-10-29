/* ==========================================================
   BASE DE DATOS FALSA (SOLO PARA PRUEBAS AUTOMÁTICAS)
   Imita las respuestas de Oracle en memoria para probar la
   lógica de la API sin conexión. NO valida la sintaxis SQL:
   eso solo se comprueba contra Oracle real
   (ver npm run probar-conexion).
   ========================================================== */

import { hashearClave } from '../services/authService.js';


export function crearDbFalsa() {
  const t = {
    usuarios: [], roles: new Map(), productos: [], clientes: [], pedidos: [], detalles: [],
    sec: { usuario: 0, producto: 0, cliente: 0, pedido: 0, detalle: 0 }
  };
  const sqlEjecutado = [];

  const agregarUsuario = (nombre, nombreUsuario, clave, rol, activo = 1) => {
    const id = ++t.sec.usuario;
    t.usuarios.push({ ID_USUARIO: id, NOMBRE: nombre, NOMBRE_USUARIO: nombreUsuario, CONTRASENA_HASH: hashearClave(clave), ACTIVO: activo });
    t.roles.set(id, rol);
    return id;
  };

  const agregarProducto = (nombre, precio, stock, categoria) => {
    const p = { ID_PRODUCTO: ++t.sec.producto, NOMBRE: nombre, DESCRIPCION: null, PRECIO: precio, STOCK: stock, CATEGORIA: categoria };
    t.productos.push(p);
    return p;
  };

  const filasPedido = (filtro) => t.pedidos.filter(filtro).flatMap((p) =>
    t.detalles.filter((d) => d.ID_PEDIDO === p.ID_PEDIDO).map((d) => {
      const prod = t.productos.find((x) => x.ID_PRODUCTO === d.ID_PRODUCTO);
      return {
        ID_PEDIDO: p.ID_PEDIDO, FECHA: p.FECHA, ESTADO: p.ESTADO, TOTAL: p.TOTAL, OBSERVACIONES: p.OBSERVACIONES,
        CLIENTE: t.clientes.find((c) => c.ID_CLIENTE === p.ID_CLIENTE).NOMBRE,
        CANTIDAD: d.CANTIDAD, PRECIO_UNITARIO: d.PRECIO_UNITARIO, PRODUCTO: prod.NOMBRE, PRECIO_BASE: prod.PRECIO
      };
    }));

  const ejecutar = async (sql, b = {}) => {
    sqlEjecutado.push(sql);
    const tag = (/\/\*\s*(\w+)\s*\*\//.exec(sql) || [])[1];

    switch (tag) {
      case 'ping': return { rows: [{ OK: 1 }] };

      case 'usuario_por_nombre': {
        const u = t.usuarios.find((x) => x.NOMBRE_USUARIO.toLowerCase() === b.usuario.toLowerCase());
        return { rows: u ? [{ ...u, ROL: t.roles.get(u.ID_USUARIO) || null }] : [] };
      }
      case 'usuario_existe':
        return { rows: t.usuarios.filter((x) => x.NOMBRE_USUARIO.toLowerCase() === b.usuario.toLowerCase()) };
      case 'usuario_crear': {
        const id = agregarUsuario(b.nombre, b.usuario, 'x', null);
        t.usuarios.find((u) => u.ID_USUARIO === id).CONTRASENA_HASH = b.hash;
        return { outBinds: { id: [id] }, rowsAffected: 1 };
      }
      case 'usuario_rol_administrador': t.roles.set(b.id, 'administrador'); return { rowsAffected: 1 };
      case 'usuario_rol_cajero': t.roles.set(b.id, 'cajero'); return { rowsAffected: 1 };
      case 'usuario_rol_cocinero': t.roles.set(b.id, 'cocinero'); return { rowsAffected: 1 };
      case 'usuarios_listar':
        return { rows: t.usuarios.map((u) => ({ ...u, ROL: t.roles.get(u.ID_USUARIO) })) };

      case 'productos_listar': return { rows: [...t.productos].reverse() };
      case 'producto_nombre_duplicado':
        return { rows: t.productos.filter((p) => p.NOMBRE.toLowerCase() === b.nombre.toLowerCase() && p.ID_PRODUCTO !== b.id) };
      case 'producto_crear': {
        const p = agregarProducto(b.nombre, b.precio, b.stock, b.categoria);
        p.DESCRIPCION = b.descripcion;
        return { outBinds: { id: [p.ID_PRODUCTO] }, rowsAffected: 1 };
      }
      case 'producto_actualizar': {
        const p = t.productos.find((x) => x.ID_PRODUCTO === b.id);
        if (!p) return { rowsAffected: 0 };
        Object.assign(p, { NOMBRE: b.nombre, DESCRIPCION: b.descripcion, PRECIO: b.precio, STOCK: b.stock, CATEGORIA: b.categoria });
        return { rowsAffected: 1 };
      }
      case 'producto_eliminar': {
        if (t.detalles.some((d) => d.ID_PRODUCTO === b.id)) {
          throw Object.assign(new Error('ORA-02292: integrity constraint (ADMIN.FK_DETALLE_PRODUCTO) violated'), { errorNum: 2292 });
        }
        const antes = t.productos.length;
        t.productos = t.productos.filter((p) => p.ID_PRODUCTO !== b.id);
        return { rowsAffected: antes - t.productos.length };
      }
      case 'productos_por_ids':
        return { rows: t.productos.filter((p) => Object.values(b).includes(p.ID_PRODUCTO)) };

      case 'cliente_buscar':
        return { rows: t.clientes.filter((c) => c.NOMBRE.toLowerCase() === b.nombre.toLowerCase()) };
      case 'cliente_crear': {
        const c = { ID_CLIENTE: ++t.sec.cliente, NOMBRE: b.nombre };
        t.clientes.push(c);
        return { outBinds: { id: [c.ID_CLIENTE] }, rowsAffected: 1 };
      }

      case 'sp_crear_pedido': {
        // Imita SP_CREAR_PEDIDO: inserta pedido y detalle, suma el total y descuenta stock (CHK_STOCK_PROD)
        const items = b.items.filas;
        let total = 0;
        const id = ++t.sec.pedido;

        for (const i of items) {
          const p = t.productos.find((x) => x.ID_PRODUCTO === i.ID_PRODUCTO);
          if (p.STOCK - i.CANTIDAD < 0) {
            throw new Error('ORA-20001: Error al crear el pedido: ORA-02290: check constraint (ADMIN.CHK_STOCK_PROD) violated');
          }
        }

        t.pedidos.push({ ID_PEDIDO: id, FECHA: new Date(), ESTADO: 'PENDIENTE', TOTAL: 0, OBSERVACIONES: b.observacion, ID_CLIENTE: b.id_cliente });

        for (const i of items) {
          t.productos.find((x) => x.ID_PRODUCTO === i.ID_PRODUCTO).STOCK -= i.CANTIDAD;
          t.detalles.push({ ID_DETALLE: ++t.sec.detalle, ID_PEDIDO: id, ID_PRODUCTO: i.ID_PRODUCTO, CANTIDAD: i.CANTIDAD, PRECIO_UNITARIO: i.PRECIO_UNITARIO });
          total += i.CANTIDAD * i.PRECIO_UNITARIO;
        }

        t.pedidos.find((p) => p.ID_PEDIDO === id).TOTAL = total;
        return { outBinds: { id_pedido: id } };
      }
      case 'pedido_a_preparacion':
        t.pedidos.find((p) => p.ID_PEDIDO === b.id).ESTADO = 'EN_PREPARACION';
        return { rowsAffected: 1 };

      case 'pedidos_activos':
        return { rows: filasPedido((p) => ['PENDIENTE', 'EN_PREPARACION', 'LISTO'].includes(p.ESTADO)) };
      case 'pedido_por_id':
        return { rows: filasPedido((p) => p.ID_PEDIDO === b.id) };
      case 'pedido_estado': {
        const p = t.pedidos.find((x) => x.ID_PEDIDO === b.id);
        return { rows: p ? [{ ESTADO: p.ESTADO }] : [] };
      }
      case 'pedido_cambiar_estado': {
        const p = t.pedidos.find((x) => x.ID_PEDIDO === b.id && x.ESTADO === b.actual);
        if (p) p.ESTADO = b.nuevo;
        return { rowsAffected: p ? 1 : 0 };
      }

      default: throw new Error(`Consulta no soportada por la base falsa: ${tag}`);
    }
  };

  const sesion = async (funcion) => funcion({
    ejecutar,
    commit: async () => {},
    rollback: async () => {},
    salidaNumero: { salida: true },
    listaDe: async (tipo, filas) => ({ tipo, filas })
  });

  return { ejecutar, sesion, salidaNumero: { salida: true }, datos: t, sqlEjecutado, agregarUsuario, agregarProducto };
}
