/* ==========================================================
   NOTIFICACIONES EN TIEMPO REAL (SSE)
   Tarea #31 Notificaciones push / alertas en tiempo real

   El navegador abre UNA conexión larga (Server-Sent Events) y el
   servidor le "empuja" cada aviso apenas ocurre: pedido nuevo,
   pedido listo, stock bajo, pago aprobado, etc. No necesita
   librerías extra y funciona con el login que ya existe.

   Cada aviso se envía solo a los roles que corresponden. Los
   últimos avisos se guardan en memoria (se pierden al reiniciar
   el servidor) para mostrarlos al volver a entrar.
   ========================================================== */

import { logger } from './logger.js';


const MAX_RECIENTES = 100;
const MAX_CONEXIONES_POR_USUARIO = 3;
const MAX_CONEXIONES_TOTALES = 200;
const LATIDO_MS = 25000;                 // un "ping" cada 25 s evita que proxys y navegadores corten la conexión

const conexiones = new Set();            // { res, usuario }
const recientes = [];                    // avisos ya publicados
let secuencia = 0;
let temporizador = null;


/* ---------- Quién puede ver cada aviso ---------- */

// roles = lista de roles; usuarioId = además, un usuario puntual. Sin ninguno de los dos, lo ven todos.
export function esVisiblePara(aviso, usuario) {
  const sinFiltro = !aviso.roles && aviso.usuarioId === undefined;

  return sinFiltro
    || (aviso.roles && aviso.roles.includes(usuario.rol))
    || (aviso.usuarioId !== undefined && aviso.usuarioId === usuario.id);
}

// Lo que sale hacia el navegador (sin datos internos)
const paraEnviar = (a) => ({ id: a.id, tipo: a.tipo, nivel: a.nivel, titulo: a.titulo, mensaje: a.mensaje, datos: a.datos, fecha: a.fecha });


/* ---------- Publicar ---------- */

export function publicar({ tipo, titulo, mensaje = '', roles, usuarioId, nivel = 'info', datos = {} }) {
  const aviso = { id: ++secuencia, tipo, nivel, titulo, mensaje, roles, usuarioId, datos, fecha: new Date().toISOString() };

  recientes.push(aviso);
  if (recientes.length > MAX_RECIENTES) recientes.shift();

  for (const conexion of conexiones) {
    if (esVisiblePara(aviso, conexion.usuario)) enviar(conexion, aviso);
  }

  return aviso.id;
}

function enviar(conexion, aviso) {
  try {
    conexion.res.write(`id: ${aviso.id}\nevent: aviso\ndata: ${JSON.stringify(paraEnviar(aviso))}\n\n`);
  } catch (error) {
    logger.warn('sse_envio_fallido', { motivo: error.message });
    conexiones.delete(conexion);
  }
}


/* ---------- Conectar un navegador ---------- */

export function conectar(req, res, usuario, ultimoId = 0) {
  if (conexiones.size >= MAX_CONEXIONES_TOTALES) {
    return res.status(503).json({ status: 'error', errors: ['Hay demasiadas conexiones abiertas. Inténtalo en unos minutos.'] });
  }

  // Un usuario con muchas pestañas abiertas: se cierran las más antiguas
  const delUsuario = [...conexiones].filter((c) => c.usuario.id === usuario.id);
  while (delUsuario.length >= MAX_CONEXIONES_POR_USUARIO) {
    const vieja = delUsuario.shift();
    vieja.res.end();
    conexiones.delete(vieja);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'            // si hay nginx delante, que no acumule los avisos
  });

  req.socket.setTimeout(0);
  res.write('retry: 3000\n\n');           // si se corta, el navegador reintenta en 3 s

  const conexion = { res, usuario };
  conexiones.add(conexion);
  iniciarLatido();

  // Reconexión: se reenvía lo que se perdió mientras estuvo desconectado
  for (const aviso of recientes) {
    if (aviso.id > ultimoId && esVisiblePara(aviso, usuario)) enviar(conexion, aviso);
  }

  req.on('close', () => {
    conexiones.delete(conexion);
    if (!conexiones.size) detenerLatido();
  });
}

function iniciarLatido() {
  if (temporizador) return;

  temporizador = setInterval(() => {
    for (const conexion of conexiones) {
      try { conexion.res.write(': ping\n\n'); } catch { conexiones.delete(conexion); }
    }
  }, LATIDO_MS);

  temporizador.unref();                   // el temporizador no impide apagar el servidor
}

function detenerLatido() {
  clearInterval(temporizador);
  temporizador = null;
}


/* ---------- Consultas ---------- */

export function listarAvisos(usuario, limite = 30) {
  return recientes.filter((a) => esVisiblePara(a, usuario)).slice(-limite).reverse().map(paraEnviar);
}

export const totalConectados = () => conexiones.size;

// Cierra todas las conexiones (al apagar el servidor y en las pruebas)
export function cerrarConexiones() {
  for (const conexion of conexiones) conexion.res.end();
  conexiones.clear();
  detenerLatido();
}

export function reiniciarEventos() {
  cerrarConexiones();
  recientes.length = 0;
  secuencia = 0;
}
