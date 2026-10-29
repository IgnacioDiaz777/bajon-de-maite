/* ==========================================================
   ARRANQUE Y NAVEGACIÓN
   Decide qué pantalla mostrar según la ruta (#/inicio, etc.)
   y si hay una sesión iniciada. Los datos se cargan desde la
   API (Oracle) al entrar.
   ========================================================== */

import { estado, cargarDatos, restaurarSesion, cerrarSesion } from './estado.js';
import { cuandoExpireLaSesion } from './api.js';
import { mostrarToast } from './utilidades.js';
import { renderNavegacion } from '../componentes/navegacion.js';

import { renderLogin } from '../secciones/login/login.js';
import { renderInicio } from '../secciones/inicio/inicio.js';
import { renderProductos } from '../secciones/productos/productos.js';
import { renderPedidos } from '../secciones/pedidos/pedidos.js';
import { renderAjustes } from '../secciones/ajustes/ajustes.js';


const RUTAS = {
  inicio: renderInicio,
  productos: renderProductos,
  pedidos: renderPedidos,
  ajustes: renderAjustes
};


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


async function navegar() {
  const raiz = document.getElementById('app');
  const ruta = location.hash.replace('#/', '') || 'inicio';

  /* Sin sesión: solo se puede ver el login */
  if (!estado.usuario) {
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

  const rutaValida = RUTAS[ruta] ? ruta : 'inicio';

  raiz.innerHTML = `<main class="pantalla" id="pantalla"></main>${renderNavegacion(rutaValida)}`;
  RUTAS[rutaValida](document.getElementById('pantalla'));
  window.scrollTo(0, 0);
}


function iniciar() {
  restaurarSesion();

  cuandoExpireLaSesion(() => {
    cerrarSesion();
    location.hash = '#/login';
    mostrarToast('Tu sesión venció. Inicia sesión nuevamente.', 'error');
  });

  window.addEventListener('hashchange', navegar);
  navegar();
}


iniciar();
