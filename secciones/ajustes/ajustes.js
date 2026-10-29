/* ==========================================================
   SECCIÓN: AJUSTES
   Datos de la cuenta, del local y cierre de sesión.
   ========================================================== */

import { estado, cargarDatos, cerrarSesion } from '../../nucleo/estado.js';
import { icono, esc, mostrarToast } from '../../nucleo/utilidades.js';
import { actualizarInsigniaPedidos } from '../../componentes/navegacion.js';


export function renderAjustes(contenedor) {
  contenedor.innerHTML = `
    <h1 class="titulo">Ajustes</h1>
    <p class="subtitulo">Tu cuenta y tu local.</p>


    <section class="ajuste-tarjeta">
      <div class="avatar avatar-grande">${esc(estado.usuario.iniciales)}</div>

      <div>
        <strong>${esc(estado.usuario.nombre)}</strong>
        <p>${esc(estado.usuario.usuario)} · ${esc(estado.usuario.rol)}</p>
      </div>
    </section>


    <section class="ajuste-tarjeta ajuste-columna">
      <div>
        <small>Local</small>
        <strong>El bajón de Maite</strong>
      </div>

      <div>
        <small>Retiro en local</small>
        <strong>${esc(estado.inicio.local)}</strong>
      </div>
    </section>


    <div class="ajuste-acciones">
      <button class="btn btn-secundario btn-bloque" id="actualizar">Actualizar datos</button>
      <button class="btn btn-peligro btn-bloque" id="salir">${icono('salir', 18)} Cerrar sesión</button>
    </div>
  `;


  contenedor.querySelector('#actualizar').addEventListener('click', async () => {
    try {
      await cargarDatos();
      actualizarInsigniaPedidos();
      mostrarToast('Datos actualizados desde la base de datos');
    } catch (error) {
      mostrarToast(error.message, 'error');
    }
  });

  contenedor.querySelector('#salir').addEventListener('click', () => {
    cerrarSesion();
    location.hash = '#/login';
  });
}
