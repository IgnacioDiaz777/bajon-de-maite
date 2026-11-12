/* ==========================================================
   ARRANQUE Y NAVEGACIÓN
   Decide qué pantalla mostrar según la ruta (#/inicio, etc.)
   y si hay una sesión iniciada. Los datos se cargan desde la
   API (Oracle) al entrar.
   ========================================================== */

import { estado, cargarDatos, restaurarSesion, cerrarSesion, puede, recargarPedidos, recargarProductos } from './estado.js';
import { cuandoExpireLaSesion } from './api.js';
import { mostrarToast } from './utilidades.js';
import { renderNavegacion } from '../componentes/navegacion.js';

import { renderLogin } from '../secciones/login/login.js';
import { renderInicio } from '../secciones/inicio/inicio.js';
import { renderProductos } from '../secciones/productos/productos.js';
import { renderPedidos } from '../secciones/pedidos/pedidos.js';
import { renderAjustes } from '../secciones/ajustes/ajustes.js';
import { renderAdmin } from '../secciones/admin/admin.js';
import { renderClientes } from '../secciones/clientes/clientes.js';
import { reportarFalloAutomatico } from '../componentes/feedback.js';
import { iniciarNotificaciones, detenerNotificaciones, abrirAvisos, actualizarInsigniaAvisos } from '../componentes/notificaciones.js';


const RUTAS = {
  inicio: renderInicio,
  productos: renderProductos,
  pedidos: renderPedidos,
  ajustes: renderAjustes,
  admin: renderAdmin,
  clientes: renderClientes
};

const MENSAJE_PAGO = {
  autorizado: ['Pago aprobado ✓', 'ok'],
  rechazado: ['El pago fue rechazado. Puedes intentarlo de nuevo.', 'error'],
  cancelado: ['El pago se canceló.', 'error'],
  pendiente: ['Estamos confirmando el pago. Revisa en unos minutos.', 'error'],
  desconocido: ['No se encontró ese pago.', 'error'],
  error: ['No se pudo confirmar el pago. Revisa el pedido.', 'error']
};

// Pantallas que no están en la barra de abajo se muestran bajo la pestaña que las abre
const PESTANA_ACTIVA = { admin: 'ajustes', clientes: 'ajustes' };


function pantallaMensaje(raiz, titulo, texto, conReintento = false) {
  raiz.innerHTML = `
    <main class="pantalla">
      <h1 class="titulo">${titulo}</h1>
      <p class="subtitulo">${texto}</p>
      ${conReintento ? '<button class="btn btn-primario" id="reintentar" style="margin-top:20px">Reintentar</button>' : ''}
    </main>`;

  const boton = raiz.querySelector('#reintentar');
  if (boton) boton.addEventListener('click', navegar);
}


/* Cuando llega un aviso en tiempo real, los datos de la pantalla se actualizan solos */
let actualizando = false;

async function alRecibirAviso(aviso) {
  const cambiaronPedidos = ['pedido_nuevo', 'pedido_listo', 'pago_aprobado', 'pago_anulado', 'pago_rechazado', 'reconectado'].includes(aviso.tipo);
  const cambioElStock = ['stock_bajo', 'stock_agotado', 'pedido_nuevo', 'reconectado'].includes(aviso.tipo);

  if (!estado.usuario || actualizando || (!cambiaronPedidos && !cambioElStock)) return;
  actualizando = true;

  try {
    await Promise.all([cambiaronPedidos ? recargarPedidos() : null, cambioElStock ? recargarProductos() : null]);

    // Solo se vuelve a pintar si no hay una ventana abierta ni alguien escribiendo (para no borrarle lo que escribe)
    const escribiendo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
    const ruta = location.hash.replace('#/', '').split('?')[0];

    if (!document.querySelector('.modal-fondo') && !escribiendo && ['pedidos', 'productos', 'inicio'].includes(ruta)) {
      RUTAS[ruta](document.getElementById('pantalla'));
    }
  } catch { /* si falla, la próxima acción lo vuelve a intentar */ } finally {
    actualizando = false;
  }
}

async function navegar() {
  const raiz = document.getElementById('app');
  const [ruta, consulta] = (location.hash.replace('#/', '') || 'inicio').split('?');     // "pedidos?pago=autorizado" → ruta + consulta

  /* Sin sesión: solo se puede ver el login */
  if (!estado.usuario) {
    detenerNotificaciones();

    if (ruta !== 'login') {
      location.hash = '#/login';
      return;
    }

    renderLogin(raiz);
    return;
  }

  /* Con sesión: el login ya no aplica */
  if (ruta === 'login') {
    location.hash = '#/inicio';
    return;
  }

  /* Primera carga de datos desde Oracle */
  if (!estado.cargado) {
    pantallaMensaje(raiz, 'Cargando…', 'Trayendo tus datos.');

    try {
      await cargarDatos();
    } catch (error) {
      if (!estado.usuario) return; // la sesión venció mientras cargaba
      pantallaMensaje(raiz, 'Ups…', error.message, true);
      return;
    }
  }

  let rutaValida = RUTAS[ruta] ? ruta : 'inicio';

  /* Administración: solo para el administrador (el backend lo vuelve a comprobar) */
  if (rutaValida === 'admin' && !puede('verAdmin')) rutaValida = 'inicio';

  raiz.innerHTML = `<main class="pantalla" id="pantalla"></main>${renderNavegacion(PESTANA_ACTIVA[rutaValida] || rutaValida)}`;
  RUTAS[rutaValida](document.getElementById('pantalla'));
  window.scrollTo(0, 0);

  /* Avisos en tiempo real: botón de la barra y conexión (se abre una sola vez por sesión) */
  document.getElementById('nav-avisos').addEventListener('click', abrirAvisos);
  actualizarInsigniaAvisos();
  iniciarNotificaciones(alRecibirAviso);

  /* Vuelta desde Webpay: "#/pedidos?pago=autorizado&pedido=12" */
  const parametros = new URLSearchParams(consulta || '');

  if (parametros.has('pago')) {
    const [mensaje, tipo] = MENSAJE_PAGO[parametros.get('pago')] || MENSAJE_PAGO.error;
    mostrarToast(mensaje, tipo);
    history.replaceState(null, '', `${location.pathname}${location.search}#/pedidos`);       // limpia la dirección
  }
}


function iniciar() {
  restaurarSesion();

  cuandoExpireLaSesion(() => {
    cerrarSesion();
    location.hash = '#/login';
    mostrarToast('Tu sesión venció. Inicia sesión nuevamente.', 'error');
  });

  // Sprint 4 · #28: los errores de JavaScript se reportan solos (con límites para no llenar la tabla)
  window.addEventListener('error', (e) => reportarFalloAutomatico(e.message));
  window.addEventListener('unhandledrejection', (e) => reportarFalloAutomatico(e.reason && e.reason.message ? e.reason.message : e.reason));

  window.addEventListener('hashchange', navegar);
  navegar();
}


iniciar();
