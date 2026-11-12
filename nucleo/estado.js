/* ==========================================================
   ESTADO DE LA APP
   Guarda en memoria lo que llega desde la API (que lee Oracle)
   y el pedido en borrador. Las reglas de verdad (stock, precios,
   permisos) las valida el backend; aquí solo se evita enviar
   datos obviamente incorrectos.
   ========================================================== */

import { cargarJSON } from './utilidades.js';
import { api, fijarToken } from './api.js';


const CLAVE_SESION = 'bajon_sesion';

// Datos solo visuales (emoji, foto, rating...) que no existen en la base de datos
const RUTA_CATALOGO = 'secciones/productos/catalogo-visual.json';
const RUTA_INICIO = 'secciones/inicio/inicio.json';

const EMOJI_POR_CATEGORIA = { COMIDA: '🍽️', BEBIDA: '🥤', POSTRE: '🍰', OTRO: '🍟' };

// Qué puede hacer cada rol (el backend vuelve a comprobarlo)
const PERMISOS = {
  gestionarProductos: ['administrador'],
  crearPedido: ['administrador', 'cajero'],
  marcarListo: ['administrador', 'cocinero'],
  marcarEntregado: ['administrador', 'cajero'],
  verAdmin: ['administrador'],           // Sprint 4: pantalla de Administración
  verClientes: ['administrador', 'cajero'],   // tarea 33: clientes y direcciones
  eliminarClientes: ['administrador'],
  cobrar: ['administrador', 'cajero']         // tarea 32: cobrar pedidos
};


/* ---------- Estado global ---------- */

export const estado = {
  usuario: null,
  cargado: false,
  productos: [],
  pedidos: [],
  pagos: {},                 // idPedido → { estado, metodo, monto } (solo para quien puede cobrar)
  pagosDisponibles: true,    // false si todavía no se crearon las tablas de pagos
  catalogo: {},
  inicio: {},
  borrador: nuevoBorrador()
};

function nuevoBorrador() {
  // idCliente / idDireccion / direcciones: solo cuando se elige un cliente registrado (tarea 33)
  return { cliente: '', tipo: 'Para llevar', nota: '', items: [], idCliente: null, idDireccion: null, direcciones: [] };
}

export function puede(accion) {
  return PERMISOS[accion].includes(estado.usuario && estado.usuario.rol);
}


/* ---------- Sesión ---------- */

export function restaurarSesion() {
  try {
    const guardada = JSON.parse(sessionStorage.getItem(CLAVE_SESION));

    if (guardada && guardada.token && guardada.usuario) {
      estado.usuario = guardada.usuario;
      fijarToken(guardada.token);
    }
  } catch {
    estado.usuario = null;
  }
}

export async function iniciarSesion(usuario, password) {
  const respuesta = await api('/api/auth/login', { metodo: 'POST', cuerpo: { usuario, password } });

  estado.usuario = respuesta.usuario;
  fijarToken(respuesta.token);

  try {
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ usuario: respuesta.usuario, token: respuesta.token }));
  } catch { /* sin almacenamiento: la sesión dura solo mientras la página siga abierta */ }
}

// Después de cambiar el nombre en "Mi perfil": se guarda el usuario y el token nuevos
export function actualizarSesion(usuario, token) {
  estado.usuario = usuario;
  fijarToken(token);

  try {
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ usuario, token }));
  } catch { /* sin almacenamiento */ }
}

export function cerrarSesion() {
  estado.usuario = null;
  estado.cargado = false;
  estado.productos = [];
  estado.pedidos = [];
  estado.borrador = nuevoBorrador();
  fijarToken(null);

  try {
    sessionStorage.removeItem(CLAVE_SESION);
  } catch { /* nada que limpiar */ }
}


/* ---------- Carga de datos desde la API ---------- */

function enriquecerProducto(p) {
  const visual = estado.catalogo[p.nombre.trim().toLowerCase()] || {};

  return {
    emoji: EMOJI_POR_CATEGORIA[p.categoria] || '🍽️',
    color: '#F4F4F2',
    imagen: '',
    resumen: '',
    tiempo: '10–15 min',
    rating: 0,
    resenas: 0,
    etiqueta: '',
    permiteCombo: false,
    precioCombo: 0,
    ...visual,
    ...p,
    descripcion: p.descripcion || visual.descripcion || visual.resumen || ''
  };
}

export async function recargarProductos() {
  const respuesta = await api('/api/productos');
  estado.productos = respuesta.data.map(enriquecerProducto);
}

export async function recargarPedidos() {
  const respuesta = await api('/api/pedidos');
  estado.pedidos = respuesta.data.map((p) => ({ ...p, creado: new Date(p.fecha).getTime() }));

  await recargarPagos();
}

// Estado de pago de los pedidos en cocina. Si falla (ej. faltan las tablas), la pantalla sigue sin los datos de pago.
export async function recargarPagos() {
  estado.pagos = {};
  estado.pagosDisponibles = puede('cobrar');

  if (!puede('cobrar') || !estado.pedidos.length) return;

  try {
    const ids = estado.pedidos.slice(0, 100).map((p) => p.numero).join(',');
    const respuesta = await api(`/api/pagos?pedidos=${ids}`);
    estado.pagos = Object.fromEntries(respuesta.data.map((p) => [p.idPedido, p]));
  } catch {
    estado.pagosDisponibles = false;
  }
}

export async function cargarDatos() {
  const [catalogo, inicio] = await Promise.all([cargarJSON(RUTA_CATALOGO), cargarJSON(RUTA_INICIO)]);

  estado.catalogo = catalogo;
  estado.inicio = inicio;

  await Promise.all([recargarProductos(), recargarPedidos()]);
  estado.cargado = true;
}


/* ---------- Productos ---------- */

export function buscarProducto(id) {
  return estado.productos.find((p) => p.id === id);
}

export function buscarProductoPorNombre(nombre) {
  return estado.productos.find((p) => p.nombre.toLowerCase() === String(nombre).toLowerCase());
}

/* 'disponible' | 'poco' | 'agotado' */
export function estadoStock(producto) {
  if (producto.stock <= 0) return 'agotado';
  if (producto.stock <= 5) return 'poco';
  return 'disponible';
}

export async function guardarProducto(datos, id = null) {
  await api(id ? `/api/productos/${id}` : '/api/productos', { metodo: id ? 'PUT' : 'POST', cuerpo: datos });
  await recargarProductos();
}

export async function eliminarProducto(id) {
  await api(`/api/productos/${id}`, { metodo: 'DELETE' });
  await recargarProductos();
}


/* ---------- Pedido en borrador ---------- */

export function precioItem(item) {
  const producto = buscarProducto(item.idProducto);
  return producto.precio + (item.combo ? producto.precioCombo || 0 : 0);
}

export function agregarAlBorrador(idProducto, cantidad = 1, combo = false) {
  const existente = estado.borrador.items.find((i) => i.idProducto === idProducto && i.combo === combo);

  if (existente) {
    existente.cantidad += cantidad;
  } else {
    estado.borrador.items.push({ idProducto, cantidad, combo });
  }
}

export function cantidadEnBorrador(idProducto) {
  return estado.borrador.items
    .filter((i) => i.idProducto === idProducto)
    .reduce((suma, i) => suma + i.cantidad, 0);
}

export function cambiarCantidad(indice, delta) {
  const item = estado.borrador.items[indice];
  if (!item) return;

  item.cantidad += delta;

  if (item.cantidad <= 0) {
    estado.borrador.items.splice(indice, 1);
  }
}

export function totalProductosBorrador() {
  return estado.borrador.items.reduce((suma, i) => suma + i.cantidad, 0);
}

export function totalBorrador() {
  return estado.borrador.items.reduce((suma, i) => suma + precioItem(i) * i.cantidad, 0);
}


/* ---------- Envío a cocina (Oracle: SP_CREAR_PEDIDO) ---------- */

export async function enviarPedido() {
  const { cliente, tipo, nota, items, idCliente, idDireccion } = estado.borrador;

  if (!cliente.trim()) return { ok: false, campo: 'cliente', error: 'Ingresa el nombre del cliente.' };
  if (tipo === 'Despacho' && !idCliente) return { ok: false, campo: 'cliente', error: 'Para un despacho elige un cliente registrado.' };
  if (tipo === 'Despacho' && !idDireccion) return { ok: false, campo: 'pedido', error: 'Elige la dirección de despacho (o agrégala en la ficha del cliente).' };
  if (items.length === 0) return { ok: false, campo: 'pedido', error: 'Agrega al menos un producto al pedido.' };

  const cuerpo = {
    nombreCliente: cliente.trim(),
    tipoEntrega: tipo,
    notaCocinero: nota.trim(),
    ...(idCliente ? { idCliente } : {}),
    ...(tipo === 'Despacho' ? { idDireccion } : {}),
    productos: items.map((i) => ({ productoId: i.idProducto, cantidad: i.cantidad, combo: i.combo }))
  };

  try {
    const respuesta = await api('/api/pedidos', { metodo: 'POST', cuerpo });

    estado.borrador = nuevoBorrador();
    await Promise.all([recargarProductos(), recargarPedidos()]); // el stock y la cocina cambiaron

    return { ok: true, pedido: respuesta.data };
  } catch (error) {
    return { ok: false, campo: 'pedido', error: error.message };
  }
}


/* ---------- Seguimiento de pedidos ---------- */

export async function avanzarPedido(numero) {
  const respuesta = await api(`/api/pedidos/${numero}/avanzar`, { metodo: 'POST' });
  await recargarPedidos();
  return respuesta.data;
}

export function pedidosEnCocina() {
  return estado.pedidos.filter((p) => p.estado !== 'Entregado' && p.estado !== 'Cancelado');
}
