/* ==========================================================
   SECCIÓN: AJUSTES
   Datos de la cuenta, del local y cierre de sesión.
   ========================================================== */

import { estado, cargarDatos, cerrarSesion, puede } from '../../nucleo/estado.js';
import { icono, esc, mostrarToast } from '../../nucleo/utilidades.js';
import { actualizarInsigniaPedidos } from '../../componentes/navegacion.js';
import { abrirFeedback } from '../../componentes/feedback.js';
import { abrirPerfil } from '../../componentes/perfil.js';
import { sonidoActivo, fijarSonido, permisoNavegador, pedirPermisoNavegador } from '../../componentes/notificaciones.js';


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


    <section class="ajuste-tarjeta ajuste-columna">
      <div><small>Alertas en tiempo real</small><strong>Pedidos, stock y pagos</strong></div>
      <div class="ajuste-fila">
        <button class="btn btn-secundario" id="sonido"></button>
        <button class="btn btn-secundario" id="permiso"></button>
      </div>
    </section>


    <div class="ajuste-acciones">
      <button class="btn btn-secundario btn-bloque" id="perfil">${icono('usuario', 18)} Mi perfil y contraseña</button>
      ${puede('verClientes') ? `<a class="btn btn-secundario btn-bloque" href="#/clientes">${icono('flecha', 18)} Clientes y direcciones</a>` : ''}
      ${puede('verAdmin') ? `<a class="btn btn-primario btn-bloque" href="#/admin">Administración</a>` : ''}
      <button class="btn btn-secundario btn-bloque" id="feedback">${icono('mensaje', 18)} Comentarios y reporte de fallos</button>
      <button class="btn btn-secundario btn-bloque" id="actualizar">Actualizar datos</button>
      <button class="btn btn-peligro btn-bloque" id="salir">${icono('salir', 18)} Cerrar sesión</button>
    </div>
  `;


  contenedor.querySelector('#perfil').addEventListener('click', () => abrirPerfil(() => renderAjustes(contenedor)));

  /* ----- Alertas: sonido y avisos del navegador ----- */

  const botonSonido = contenedor.querySelector('#sonido');
  const botonPermiso = contenedor.querySelector('#permiso');

  const pintarAlertas = () => {
    botonSonido.textContent = `Sonido: ${sonidoActivo() ? 'activado' : 'apagado'}`;

    const permiso = permisoNavegador();
    botonPermiso.textContent = { granted: 'Avisos del navegador: sí', denied: 'Avisos del navegador: bloqueados', default: 'Activar avisos del navegador', 'no-soportado': 'Avisos no disponibles aquí' }[permiso];
    botonPermiso.disabled = permiso !== 'default';
  };

  botonSonido.addEventListener('click', () => { fijarSonido(!sonidoActivo()); pintarAlertas(); });
  botonPermiso.addEventListener('click', async () => { await pedirPermisoNavegador(); pintarAlertas(); });
  pintarAlertas();


  contenedor.querySelector('#actualizar').addEventListener('click', async () => {
    try {
      await cargarDatos();
      actualizarInsigniaPedidos();
      mostrarToast('Datos actualizados desde la base de datos');
    } catch (error) {
      mostrarToast(error.message, 'error');
    }
  });

  contenedor.querySelector('#feedback').addEventListener('click', () => abrirFeedback());

  contenedor.querySelector('#salir').addEventListener('click', () => {
    cerrarSesion();
    location.hash = '#/login';
  });
}
