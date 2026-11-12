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
    auditoria: [], feedback: [], perfiles: [], direcciones: [], pagos: [],
    sec: { usuario: 0, producto: 0, cliente: 0, pedido: 0, detalle: 0, auditoria: 0, feedback: 0, direccion: 0, pago: 0 },

    // Para probar respaldos: columnas "identity" que simula el diccionario de Oracle, SQL de DDL y orden de operaciones
    identidades: [], ddl: [], borradas: [], insertadas: [], fallarAlInsertar: null
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

  /* ---------- Soporte de respaldo / restauración (Sprint 4 · #30) ---------- */

  const T = 'TIMESTAMP(6)';
  const col = (nombre, tipo = 'VARCHAR2') => ({ nombre, tipo });

  // Estructura que "ve" el diccionario de Oracle para cada tabla (VENTA y REPORTE no existen en la base falsa)
  const ESTRUCTURA = {
    USUARIO: [col('ID_USUARIO', 'NUMBER'), col('NOMBRE'), col('NOMBRE_USUARIO'), col('CONTRASENA_HASH'), col('ACTIVO', 'NUMBER')],
    ADMINISTRADOR: [col('ID_USUARIO', 'NUMBER')],
    CAJERO: [col('ID_USUARIO', 'NUMBER')],
    COCINERO: [col('ID_USUARIO', 'NUMBER')],
    CLIENTE: [col('ID_CLIENTE', 'NUMBER'), col('NOMBRE')],
    PRODUCTO: [col('ID_PRODUCTO', 'NUMBER'), col('NOMBRE'), col('DESCRIPCION'), col('PRECIO', 'NUMBER'), col('STOCK', 'NUMBER'), col('CATEGORIA')],
    PEDIDO: [col('ID_PEDIDO', 'NUMBER'), col('FECHA', T), col('ESTADO'), col('TOTAL', 'NUMBER'), col('OBSERVACIONES'), col('ID_CLIENTE', 'NUMBER')],
    DETALLE_PEDIDO: [col('ID_DETALLE', 'NUMBER'), col('ID_PEDIDO', 'NUMBER'), col('ID_PRODUCTO', 'NUMBER'), col('CANTIDAD', 'NUMBER'), col('PRECIO_UNITARIO', 'NUMBER')],
    AUDITORIA: [col('ID_AUDITORIA', 'NUMBER'), col('FECHA', T), col('ID_USUARIO', 'NUMBER'), col('USUARIO'), col('ROL'), col('ACCION'), col('ENTIDAD'), col('ID_ENTIDAD'), col('RESULTADO'), col('DETALLE'), col('IP')],
    CLIENTE_PERFIL: [col('ID_CLIENTE', 'NUMBER'), col('TELEFONO'), col('EMAIL'), col('NOTAS'), col('FECHA_ACTUALIZACION', T)],
    DIRECCION_DESPACHO: [col('ID_DIRECCION', 'NUMBER'), col('ID_CLIENTE', 'NUMBER'), col('ALIAS'), col('CALLE'), col('NUMERO'), col('DEPTO'), col('COMUNA'), col('CIUDAD'), col('REFERENCIA'), col('ES_PRINCIPAL', 'NUMBER'), col('ACTIVA', 'NUMBER'), col('FECHA_CREACION', T)],
    PAGO: [col('ID_PAGO', 'NUMBER'), col('ID_PEDIDO', 'NUMBER'), col('METODO'), col('PROVEEDOR'), col('MONTO', 'NUMBER'), col('ESTADO'), col('BUY_ORDER'), col('TOKEN'), col('CODIGO_AUTORIZACION'), col('CODIGO_RESPUESTA', 'NUMBER'), col('TIPO_TARJETA'), col('ULTIMOS4'), col('CUOTAS', 'NUMBER'), col('MONTO_REEMBOLSADO', 'NUMBER'), col('ID_USUARIO', 'NUMBER'), col('USUARIO'), col('DETALLE'), col('FECHA_CREACION', T), col('FECHA_ACTUALIZACION', T)],
    FEEDBACK: [col('ID_FEEDBACK', 'NUMBER'), col('FECHA', T), col('ID_USUARIO', 'NUMBER'), col('USUARIO'), col('TIPO'), col('GRAVEDAD'), col('TITULO'), col('DESCRIPCION'), col('PANTALLA'), col('ORIGEN'), col('ESTADO'), col('FECHA_RESOLUCION', T)]
  };

  const DEPENDENCIAS = [
    { HIJA: 'ADMINISTRADOR', PADRE: 'USUARIO' }, { HIJA: 'CAJERO', PADRE: 'USUARIO' }, { HIJA: 'COCINERO', PADRE: 'USUARIO' },
    { HIJA: 'CLIENTE_PERFIL', PADRE: 'CLIENTE' }, { HIJA: 'DIRECCION_DESPACHO', PADRE: 'CLIENTE' }, { HIJA: 'PAGO', PADRE: 'PEDIDO' },
    { HIJA: 'PEDIDO', PADRE: 'CLIENTE' }, { HIJA: 'DETALLE_PEDIDO', PADRE: 'PEDIDO' }, { HIJA: 'DETALLE_PEDIDO', PADRE: 'PRODUCTO' }
  ];

  const CAMPO_DE_TABLA = {
    USUARIO: 'usuarios', PRODUCTO: 'productos', CLIENTE: 'clientes', PEDIDO: 'pedidos',
    DETALLE_PEDIDO: 'detalles', AUDITORIA: 'auditoria', FEEDBACK: 'feedback',
    CLIENTE_PERFIL: 'perfiles', DIRECCION_DESPACHO: 'direcciones', PAGO: 'pagos'
  };
  const ROL_DE_TABLA = { ADMINISTRADOR: 'administrador', CAJERO: 'cajero', COCINERO: 'cocinero' };

  const tablaDeSql = (sql) => (/(?:FROM|INTO)\s+(\w+)/i.exec(sql) || [])[1];
  const bindsComoLista = (b) => Object.entries(b).filter(([k]) => /^t\d+$/.test(k)).map(([, v]) => v);

  const leerTabla = (tabla) => {
    if (ROL_DE_TABLA[tabla]) return [...t.roles].filter(([, r]) => r === ROL_DE_TABLA[tabla]).map(([id]) => ({ ID_USUARIO: id }));
    return t[CAMPO_DE_TABLA[tabla]].map((fila) => ({ ...fila }));
  };

  const copiarEstado = () => structuredClone({
    usuarios: t.usuarios, roles: t.roles, productos: t.productos, clientes: t.clientes,
    pedidos: t.pedidos, detalles: t.detalles, auditoria: t.auditoria, feedback: t.feedback,
    perfiles: t.perfiles, direcciones: t.direcciones, pagos: t.pagos
  });

  const fechaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Pedidos no cancelados dentro del rango desde/hasta (inclusive), como el filtro SQL de la analítica
  const ventasEnRango = (b) => {
    const [a1, m1, d1] = b.desde.split('-').map(Number);
    const [a2, m2, d2] = b.hasta.split('-').map(Number);
    const inicio = new Date(a1, m1 - 1, d1).getTime();
    const fin = new Date(a2, m2 - 1, d2 + 1).getTime();

    return t.pedidos.filter((p) => p.ESTADO !== 'CANCELADO' && p.FECHA.getTime() >= inicio && p.FECHA.getTime() < fin);
  };

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
        const c = { ID_CLIENTE: ++t.sec.cliente, NOMBRE: b.nombre, ACTIVO: 1 };
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


      /* ---------- Tarea #33 · clientes, direcciones y perfil ---------- */
      case 'clientes_listar': {
        const texto = (b.buscar || '').replace(/\\(.)/g, '$1').replace(/^%|%$/g, '');
        const filas = t.clientes
          .filter((c) => c.ACTIVO !== 0)
          .map((c) => ({ c, p: t.perfiles.find((x) => x.ID_CLIENTE === c.ID_CLIENTE) || {} }))
          .filter(({ c, p }) => !texto || c.NOMBRE.toLowerCase().includes(texto) || (p.TELEFONO || '').includes(texto))
          .sort((x, y) => x.c.NOMBRE.toLowerCase().localeCompare(y.c.NOMBRE.toLowerCase()))
          .map(({ c, p }) => ({
            ID_CLIENTE: c.ID_CLIENTE, NOMBRE: c.NOMBRE, TELEFONO: p.TELEFONO, EMAIL: p.EMAIL, NOTAS: p.NOTAS,
            DIRECCIONES: t.direcciones.filter((d) => d.ID_CLIENTE === c.ID_CLIENTE && d.ACTIVA === 1).length
          }));
        return { rows: filas.slice(0, b.limite) };
      }
      case 'cliente_obtener': {
        const c = t.clientes.find((x) => x.ID_CLIENTE === b.id && x.ACTIVO !== 0);
        if (!c) return { rows: [] };
        const p = t.perfiles.find((x) => x.ID_CLIENTE === b.id) || {};
        return { rows: [{ ID_CLIENTE: c.ID_CLIENTE, NOMBRE: c.NOMBRE, TELEFONO: p.TELEFONO, EMAIL: p.EMAIL, NOTAS: p.NOTAS }] };
      }
      case 'cliente_por_id':
      case 'cliente_existe': {
        const c = t.clientes.find((x) => x.ID_CLIENTE === b.id && x.ACTIVO !== 0);
        return { rows: c ? [{ ID_CLIENTE: c.ID_CLIENTE, NOMBRE: c.NOMBRE }] : [] };
      }
      case 'direcciones_listar':
        return { rows: t.direcciones.filter((d) => d.ID_CLIENTE === b.id && d.ACTIVA === 1).sort((x, y) => y.ES_PRINCIPAL - x.ES_PRINCIPAL || x.ID_DIRECCION - y.ID_DIRECCION) };
      case 'cliente_nombre_duplicado':
        return { rows: t.clientes.filter((c) => c.ACTIVO !== 0 && c.NOMBRE.toLowerCase() === b.nombre.toLowerCase() && c.ID_CLIENTE !== b.id) };
      case 'cliente_perfil_guardar': {
        const existente = t.perfiles.find((x) => x.ID_CLIENTE === b.id);
        if (existente) Object.assign(existente, { TELEFONO: b.telefono, EMAIL: b.email, NOTAS: b.notas, FECHA_ACTUALIZACION: new Date() });
        else t.perfiles.push({ ID_CLIENTE: b.id, TELEFONO: b.telefono, EMAIL: b.email, NOTAS: b.notas, FECHA_ACTUALIZACION: new Date() });
        return { rowsAffected: 1 };
      }
      case 'cliente_actualizar': {
        const c = t.clientes.find((x) => x.ID_CLIENTE === b.id && x.ACTIVO !== 0);
        if (c) c.NOMBRE = b.nombre;
        return { rowsAffected: c ? 1 : 0 };
      }
      case 'cliente_desactivar': {
        const c = t.clientes.find((x) => x.ID_CLIENTE === b.id && x.ACTIVO !== 0);
        if (c) c.ACTIVO = 0;
        return { rowsAffected: c ? 1 : 0 };
      }
      case 'direcciones_contar':
        return { rows: [{ N: t.direcciones.filter((d) => d.ID_CLIENTE === b.idCliente && d.ACTIVA === 1).length }] };
      case 'direccion_crear': {
        const d = {
          ID_DIRECCION: ++t.sec.direccion, ID_CLIENTE: b.idCliente, ALIAS: b.alias, CALLE: b.calle, NUMERO: b.numero, DEPTO: b.depto, COMUNA: b.comuna,
          CIUDAD: b.ciudad, REFERENCIA: b.referencia, ES_PRINCIPAL: b.principal, ACTIVA: 1, FECHA_CREACION: new Date()
        };
        t.direcciones.push(d);
        return { outBinds: { id: [d.ID_DIRECCION] }, rowsAffected: 1 };
      }
      case 'direcciones_quitar_principal':
        t.direcciones.filter((d) => d.ID_CLIENTE === b.idCliente && d.ES_PRINCIPAL === 1 && d.ID_DIRECCION !== b.exceptoId).forEach((d) => { d.ES_PRINCIPAL = 0; });
        return { rowsAffected: 1 };
      case 'direccion_actualizar': {
        const d = t.direcciones.find((x) => x.ID_DIRECCION === b.idDireccion && x.ID_CLIENTE === b.idCliente && x.ACTIVA === 1);
        if (d) Object.assign(d, { ALIAS: b.alias, CALLE: b.calle, NUMERO: b.numero, DEPTO: b.depto, COMUNA: b.comuna, CIUDAD: b.ciudad, REFERENCIA: b.referencia, ES_PRINCIPAL: b.principal === 1 ? 1 : d.ES_PRINCIPAL });
        return { rowsAffected: d ? 1 : 0 };
      }
      case 'direccion_estado': {
        const d = t.direcciones.find((x) => x.ID_DIRECCION === b.idDireccion && x.ID_CLIENTE === b.idCliente && x.ACTIVA === 1);
        return { rows: d ? [{ ES_PRINCIPAL: d.ES_PRINCIPAL }] : [] };
      }
      case 'direccion_desactivar': {
        const d = t.direcciones.find((x) => x.ID_DIRECCION === b.idDireccion);
        if (d) { d.ACTIVA = 0; d.ES_PRINCIPAL = 0; }
        return { rowsAffected: d ? 1 : 0 };
      }
      case 'direccion_nueva_principal': {
        const primera = t.direcciones.filter((d) => d.ID_CLIENTE === b.idCliente && d.ACTIVA === 1).sort((x, y) => x.ID_DIRECCION - y.ID_DIRECCION)[0];
        if (primera) primera.ES_PRINCIPAL = 1;
        return { rowsAffected: primera ? 1 : 0 };
      }
      case 'direccion_para_pedido':
        return { rows: t.direcciones.filter((d) => d.ID_DIRECCION === b.idDireccion && d.ID_CLIENTE === b.idCliente && d.ACTIVA === 1) };

      case 'perfil_actualizar_nombre': {
        const u = t.usuarios.find((x) => x.ID_USUARIO === b.id && x.ACTIVO === 1);
        if (u) u.NOMBRE = b.nombre;
        return { rowsAffected: u ? 1 : 0 };
      }
      case 'perfil_clave_actual': {
        const u = t.usuarios.find((x) => x.ID_USUARIO === b.id && x.ACTIVO === 1);
        return { rows: u ? [{ CONTRASENA_HASH: u.CONTRASENA_HASH }] : [] };
      }
      case 'perfil_cambiar_clave':
        t.usuarios.find((x) => x.ID_USUARIO === b.id).CONTRASENA_HASH = b.hash;
        return { rowsAffected: 1 };

      /* ---------- Tarea #31 · stock bajo ---------- */
      case 'productos_stock_bajo': {
        const ids = Object.entries(b).filter(([k]) => /^id\d+$/.test(k)).map(([, v]) => v);
        return { rows: t.productos.filter((p) => ids.includes(p.ID_PRODUCTO) && p.STOCK <= b.umbral) };
      }

      /* ---------- Tarea #32 · pagos ---------- */
      case 'pago_pedido': {
        const p = t.pedidos.find((x) => x.ID_PEDIDO === b.id);
        return { rows: p ? [{ ID_PEDIDO: p.ID_PEDIDO, TOTAL: p.TOTAL, ESTADO: p.ESTADO }] : [] };
      }
      case 'pago_autorizado_de_pedido':
        return { rows: t.pagos.filter((g) => g.ID_PEDIDO === b.id && g.ESTADO === 'AUTORIZADO') };
      case 'pago_crear_efectivo':
      case 'pago_crear_tarjeta': {
        const efectivo = tag === 'pago_crear_efectivo';
        if (efectivo && t.pagos.some((g) => g.ID_PEDIDO === b.idPedido && g.ESTADO === 'AUTORIZADO')) {
          throw Object.assign(new Error('ORA-00001: unique constraint (ADMIN.UQ_PAGO_UN_AUTORIZADO) violated'), { errorNum: 1 });
        }
        const g = {
          ID_PAGO: ++t.sec.pago, ID_PEDIDO: b.idPedido, METODO: efectivo ? 'EFECTIVO' : 'WEBPAY', PROVEEDOR: efectivo ? 'MANUAL' : b.proveedor, MONTO: b.monto,
          ESTADO: efectivo ? 'AUTORIZADO' : 'CREADO', BUY_ORDER: efectivo ? null : b.buyOrder, TOKEN: null, CODIGO_AUTORIZACION: null, CODIGO_RESPUESTA: null,
          TIPO_TARJETA: null, ULTIMOS4: null, CUOTAS: null, MONTO_REEMBOLSADO: 0, ID_USUARIO: b.idUsuario, USUARIO: b.usuario, DETALLE: null,
          FECHA_CREACION: new Date(), FECHA_ACTUALIZACION: new Date()
        };
        t.pagos.push(g);
        return { outBinds: { id: [g.ID_PAGO] }, rowsAffected: 1 };
      }
      case 'pago_abandonar_previos': {
        const previos = t.pagos.filter((g) => g.ID_PEDIDO === b.id && g.ESTADO === 'CREADO');
        previos.forEach((g) => { g.ESTADO = 'ABANDONADO'; });
        return { rowsAffected: previos.length };
      }
      case 'pago_guardar_token': t.pagos.find((g) => g.ID_PAGO === b.id).TOKEN = b.token; return { rowsAffected: 1 };
      case 'pago_marcar': {
        const g = t.pagos.find((x) => x.ID_PAGO === b.id);
        g.ESTADO = 'RECHAZADO'; g.DETALLE = b.detalle;
        return { rowsAffected: 1 };
      }
      case 'pago_por_token': return { rows: t.pagos.filter((g) => g.TOKEN === b.token).map((g) => ({ ...g })) };
      case 'pago_abandonar': {
        const g = t.pagos.find((x) => x.ID_PAGO === b.id && x.ESTADO === 'CREADO');
        if (g) g.ESTADO = 'ABANDONADO';
        return { rowsAffected: g ? 1 : 0 };
      }
      case 'pago_bloquear': {
        const g = t.pagos.find((x) => x.TOKEN === b.token && x.ESTADO === 'CREADO');
        if (g) { g.ESTADO = 'CONFIRMANDO'; g.FECHA_ACTUALIZACION = new Date(); }
        return { rowsAffected: g ? 1 : 0 };
      }
      case 'pago_terminar': {
        const g = t.pagos.find((x) => x.ID_PAGO === b.id);
        if (b.estado === 'AUTORIZADO' && t.pagos.some((x) => x.ID_PEDIDO === g.ID_PEDIDO && x.ESTADO === 'AUTORIZADO' && x.ID_PAGO !== g.ID_PAGO)) {
          throw Object.assign(new Error('ORA-00001: unique constraint (ADMIN.UQ_PAGO_UN_AUTORIZADO) violated'), { errorNum: 1 });
        }
        Object.assign(g, { ESTADO: b.estado, CODIGO_AUTORIZACION: b.autorizacion, CODIGO_RESPUESTA: b.respuesta, TIPO_TARJETA: b.tipo, ULTIMOS4: b.ultimos4, CUOTAS: b.cuotas, DETALLE: b.detalle, FECHA_ACTUALIZACION: new Date() });
        return { rowsAffected: 1 };
      }
      case 'pago_obtener': return { rows: t.pagos.filter((g) => g.ID_PAGO === b.id).map((g) => ({ ...g })) };
      case 'pago_anular': {
        const g = t.pagos.find((x) => x.ID_PAGO === b.id && x.ESTADO === 'AUTORIZADO');
        if (g) { g.ESTADO = 'ANULADO'; g.MONTO_REEMBOLSADO = g.MONTO; g.DETALLE = b.detalle; }
        return { rowsAffected: g ? 1 : 0 };
      }
      case 'pagos_de_pedidos': {
        const ids = Object.values(b);
        return { rows: t.pagos.filter((g) => ids.includes(g.ID_PEDIDO) && !['ABANDONADO', 'EXPIRADO'].includes(g.ESTADO)) };
      }
      case 'pagos_historial':
        return { rows: t.pagos.filter((g) => !b.estado || g.ESTADO === b.estado).map((g) => ({ ...g })).reverse().slice(0, b.limite) };
      case 'pagos_expirar': {
        const limite = Date.now() - b.minutos * 60000;
        const vencidos = t.pagos.filter((g) => g.ESTADO === 'CREADO' && g.FECHA_CREACION.getTime() < limite);
        vencidos.forEach((g) => { g.ESTADO = 'EXPIRADO'; });
        return { rowsAffected: vencidos.length };
      }
      case 'pagos_confirmando':
        return { rows: t.pagos.filter((g) => g.ESTADO === 'CONFIRMANDO' && g.FECHA_ACTUALIZACION.getTime() < Date.now() - 5 * 60000).map((g) => ({ ...g })) };

      /* ---------- Tarea #34 · analítica ---------- */
      case 'analitica_resumen': {
        const f = ventasEnRango(b);
        return { rows: [{ PEDIDOS: f.length, TOTAL: f.reduce((a, p) => a + p.TOTAL, 0) }] };
      }
      case 'analitica_por_dia': {
        const dias = new Map();
        for (const p of ventasEnRango(b)) {
          const k = fechaLocal(p.FECHA);
          const d = dias.get(k) || { DIA: k, PEDIDOS: 0, TOTAL: 0 };
          d.PEDIDOS += 1; d.TOTAL += p.TOTAL; dias.set(k, d);
        }
        return { rows: [...dias.values()].sort((x, y) => x.DIA.localeCompare(y.DIA)) };
      }
      case 'analitica_por_hora': {
        const horas = new Map();
        for (const p of ventasEnRango(b)) horas.set(p.FECHA.getHours(), (horas.get(p.FECHA.getHours()) || 0) + 1);
        return { rows: [...horas.entries()].map(([HORA, PEDIDOS]) => ({ HORA, PEDIDOS })).sort((x, y) => x.HORA - y.HORA) };
      }
      case 'analitica_por_entrega': {
        const tipos = new Map();
        for (const p of ventasEnRango(b)) {
          const o = p.OBSERVACIONES || '';
          const k = o.startsWith('[Despacho') ? 'Despacho' : o.startsWith('[Mesa') ? 'Mesa' : 'Para llevar';
          const x = tipos.get(k) || { TIPO: k, PEDIDOS: 0, TOTAL: 0 };
          x.PEDIDOS += 1; x.TOTAL += p.TOTAL; tipos.set(k, x);
        }
        return { rows: [...tipos.values()].sort((x, y) => y.TOTAL - x.TOTAL) };
      }
      case 'analitica_top_productos':
      case 'analitica_por_categoria': {
        const grupos = new Map();
        const ids = new Set(ventasEnRango(b).map((p) => p.ID_PEDIDO));
        for (const d of t.detalles.filter((x) => ids.has(x.ID_PEDIDO))) {
          const pr = t.productos.find((x) => x.ID_PRODUCTO === d.ID_PRODUCTO);
          const k = tag === 'analitica_top_productos' ? pr.ID_PRODUCTO : pr.CATEGORIA;
          const g = grupos.get(k) || { NOMBRE: pr.NOMBRE, CATEGORIA: pr.CATEGORIA, UNIDADES: 0, MONTO: 0 };
          g.UNIDADES += d.CANTIDAD; g.MONTO += d.CANTIDAD * d.PRECIO_UNITARIO; grupos.set(k, g);
        }
        const filas = [...grupos.values()].sort((x, y) => y.MONTO - x.MONTO || y.UNIDADES - x.UNIDADES);
        return { rows: tag === 'analitica_top_productos' ? filas.slice(0, 5) : filas };
      }
      case 'analitica_por_metodo': {
        const ids = new Set(ventasEnRango(b).map((p) => p.ID_PEDIDO));
        const metodos = new Map();
        for (const g of t.pagos.filter((x) => x.ESTADO === 'AUTORIZADO' && ids.has(x.ID_PEDIDO))) {
          const m = metodos.get(g.METODO) || { METODO: g.METODO, PAGOS: 0, TOTAL: 0 };
          m.PAGOS += 1; m.TOTAL += g.MONTO; metodos.set(g.METODO, m);
        }
        return { rows: [...metodos.values()].sort((x, y) => y.TOTAL - x.TOTAL) };
      }
      case 'analitica_sin_cobrar': {
        const f = ventasEnRango(b).filter((p) => !t.pagos.some((g) => g.ID_PEDIDO === p.ID_PEDIDO && g.ESTADO === 'AUTORIZADO'));
        return { rows: [{ PEDIDOS: f.length, TOTAL: f.reduce((a, p) => a + p.TOTAL, 0) }] };
      }

      /* ---------- Sprint 4 · #29 Auditoría ---------- */
      case 'auditoria_registrar':
        t.auditoria.push({
          ID_AUDITORIA: ++t.sec.auditoria, FECHA: new Date(), ID_USUARIO: b.idUsuario, USUARIO: b.usuario, ROL: b.rol, ACCION: b.accion,
          ENTIDAD: b.entidad, ID_ENTIDAD: b.idEntidad, RESULTADO: b.resultado, DETALLE: b.detalle, IP: b.ip
        });
        return { rowsAffected: 1 };

      case 'auditoria_listar': {
        const filas = t.auditoria
          .filter((a) => (!b.usuario || (a.USUARIO || '').toLowerCase() === b.usuario.toLowerCase())
            && (!b.accion || a.ACCION === b.accion)
            && (!b.resultado || a.RESULTADO === b.resultado)
            && (!b.desde || a.FECHA >= new Date(`${b.desde}T00:00:00`))
            && (!b.hasta || a.FECHA < new Date(new Date(`${b.hasta}T00:00:00`).getTime() + 86400000)))
          .reverse();
        return { rows: filas.slice(0, b.limite) };
      }

      /* ---------- Sprint 4 · #28 Feedback ---------- */
      case 'feedback_crear': {
        const f = {
          ID_FEEDBACK: ++t.sec.feedback, FECHA: new Date(), ID_USUARIO: b.idUsuario, USUARIO: b.usuario, TIPO: b.tipo, GRAVEDAD: b.gravedad,
          TITULO: b.titulo, DESCRIPCION: b.descripcion, PANTALLA: b.pantalla, ORIGEN: b.origen, ESTADO: 'ABIERTO', FECHA_RESOLUCION: null
        };
        t.feedback.push(f);
        return { outBinds: { id: [f.ID_FEEDBACK] }, rowsAffected: 1 };
      }
      case 'feedback_listar': {
        const filas = t.feedback
          .filter((f) => (b.idUsuario === undefined || f.ID_USUARIO === b.idUsuario)
            && (!b.estado || f.ESTADO === b.estado)
            && (!b.tipo || f.TIPO === b.tipo))
          .reverse();
        return { rows: filas.slice(0, b.limite) };
      }
      case 'feedback_cambiar_estado': {
        const f = t.feedback.find((x) => x.ID_FEEDBACK === b.id);
        if (!f) return { rowsAffected: 0 };
        f.ESTADO = b.estado;
        f.FECHA_RESOLUCION = b.estado === 'RESUELTO' ? new Date() : null;
        return { rowsAffected: 1 };
      }

      /* ---------- Sprint 4 · #30 Respaldo y restauración ---------- */
      case 'respaldo_solo_lectura': return { rowsAffected: 0 };

      case 'respaldo_columnas': {
        const rows = bindsComoLista(b).flatMap((tabla) => (ESTRUCTURA[tabla] || [])
          .map((c) => ({ TABLE_NAME: tabla, COLUMN_NAME: c.nombre, DATA_TYPE: c.tipo })));
        return { rows };
      }
      case 'respaldo_leer': {
        const tabla = tablaDeSql(sql);
        const columnas = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql)[1].split(',').map((c) => c.trim());
        return { rows: leerTabla(tabla).map((fila) => Object.fromEntries(columnas.map((c) => [c, fila[c]]))) };
      }
      case 'respaldo_identidades': {
        const tablas = bindsComoLista(b);
        return { rows: t.identidades.filter((i) => tablas.includes(i.TABLE_NAME)) };
      }
      case 'respaldo_identidades_on_null': return { rows: [] };
      case 'respaldo_dependencias': return { rows: DEPENDENCIAS };
      case 'respaldo_identidad_ajustar': t.ddl.push(sql.replace(/\s+/g, ' ').replace(/\/\*.*?\*\/\s*/, '')); return { rowsAffected: 0 };

      case 'respaldo_borrar': {
        const tabla = tablaDeSql(sql);
        t.borradas.push(tabla);
        if (ROL_DE_TABLA[tabla]) {
          for (const [id, rol] of [...t.roles]) if (rol === ROL_DE_TABLA[tabla]) t.roles.delete(id);
        } else {
          t[CAMPO_DE_TABLA[tabla]] = [];
        }
        return { rowsAffected: 1 };
      }
      case 'respaldo_insertar': {
        const tabla = tablaDeSql(sql);
        const columnas = /\(([^)]+)\)\s+VALUES/i.exec(sql)[1].split(',').map((c) => c.trim());
        const fila = Object.fromEntries(columnas.map((c, i) => [c, b[`c${i}`]]));

        if (t.fallarAlInsertar === tabla) throw new Error(`ORA-00001: unique constraint violated (simulado en ${tabla})`);

        t.insertadas.push(tabla);
        if (ROL_DE_TABLA[tabla]) t.roles.set(fila.ID_USUARIO, ROL_DE_TABLA[tabla]);
        else t[CAMPO_DE_TABLA[tabla]].push(fila);
        return { rowsAffected: 1 };
      }

      default: throw new Error(`Consulta no soportada por la base falsa: ${tag}`);
    }
  };

  // Como en Oracle: si algo falla dentro de la sesión, los cambios se deshacen (rollback)
  const sesion = async (funcion) => {
    const antes = copiarEstado();

    try {
      return await funcion({
        ejecutar,
        commit: async () => {},
        rollback: async () => {},
        salidaNumero: { salida: true },
        texto: 'texto',
        listaDe: async (tipo, filas) => ({ tipo, filas })
      });
    } catch (error) {
      Object.assign(t, antes);
      throw error;
    }
  };

  return { ejecutar, sesion, salidaNumero: { salida: true }, datos: t, sqlEjecutado, agregarUsuario, agregarProducto };
}
