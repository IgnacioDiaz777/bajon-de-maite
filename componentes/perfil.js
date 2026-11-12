/* ==========================================================
   MI PERFIL (tarea #33)
   Cada usuario puede cambiar su nombre y su contraseña.
   ========================================================== */

import { api } from '../nucleo/api.js';
import { estado, actualizarSesion } from '../nucleo/estado.js';
import { abrirModal, esc, mostrarToast } from '../nucleo/utilidades.js';


export function abrirPerfil(alCambiar) {
  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">Mi perfil</h2>

    <div class="alerta-error" id="per-error" hidden></div>

    <div class="campo-grupo"><label for="per-nombre">Nombre</label>
      <input class="campo" id="per-nombre" maxlength="100" value="${esc(estado.usuario.nombre)}"></div>
    <button class="btn btn-primario btn-bloque" id="per-guardar">Guardar nombre</button>

    <div class="seccion-titulo"><h2>Cambiar contraseña</h2></div>

    <div class="campo-grupo"><label for="per-actual">Contraseña actual</label>
      <input class="campo" id="per-actual" type="password" autocomplete="current-password"></div>
    <div class="campo-grupo"><label for="per-nueva">Contraseña nueva</label>
      <input class="campo" id="per-nueva" type="password" autocomplete="new-password" placeholder="Mínimo 8, con letras y números"></div>
    <button class="btn btn-secundario btn-bloque" id="per-clave">Cambiar contraseña</button>

    <div class="modal-acciones"><button class="btn btn-secundario btn-bloque" data-cerrar>Cerrar</button></div>
  `);

  const error = el.querySelector('#per-error');

  const intentar = async (accion) => {
    error.hidden = true;

    try {
      await accion();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  };

  el.querySelector('#per-guardar').addEventListener('click', () => intentar(async () => {
    const respuesta = await api('/api/perfil', { metodo: 'PUT', cuerpo: { nombre: el.querySelector('#per-nombre').value } });

    actualizarSesion(respuesta.data, respuesta.token);          // el servidor entrega un token con el nombre nuevo
    mostrarToast('Perfil actualizado');
    cerrar();
    if (alCambiar) alCambiar();
  }));

  el.querySelector('#per-clave').addEventListener('click', () => intentar(async () => {
    await api('/api/perfil/clave', {
      metodo: 'PUT',
      cuerpo: { claveActual: el.querySelector('#per-actual').value, claveNueva: el.querySelector('#per-nueva').value }
    });

    el.querySelector('#per-actual').value = '';
    el.querySelector('#per-nueva').value = '';
    mostrarToast('Contraseña actualizada');
  }));
}
