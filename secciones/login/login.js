/* ==========================================================
   SECCIÓN: INICIO DE SESIÓN
   Valida en pantalla y luego consulta al backend, que revisa
   el usuario en la tabla USUARIO de Oracle y entrega su rol.
   ========================================================== */

import { estado, iniciarSesion, cargarDatos, cerrarSesion } from '../../nucleo/estado.js';
import { icono, mostrarToast } from '../../nucleo/utilidades.js';


export function renderLogin(raiz) {
  raiz.innerHTML = `
    <main class="login">

      <div class="login-marca">
        <div class="logo logo-grande">${icono('tienda', 30)}</div>
        <h1>El bajón de Maite</h1>
        <p>Gestiona tus productos y pedidos</p>
      </div>

      <form class="login-form" id="form-login" novalidate>

        <div class="campo-grupo">
          <label for="usuario">Usuario</label>
          <input class="campo" id="usuario" type="text" placeholder="Tu nombre de usuario" autocomplete="username" autocapitalize="none">
          <p class="campo-error" id="error-usuario"></p>
        </div>

        <div class="campo-grupo">
          <label for="clave">Contraseña</label>
          <div class="campo-clave">
            <input class="campo" id="clave" type="password" placeholder="Tu contraseña" autocomplete="current-password">
            <button type="button" id="ver-clave" aria-label="Mostrar u ocultar contraseña">${icono('ojo', 20)}</button>
          </div>
          <p class="campo-error" id="error-clave"></p>
        </div>

        <p class="alerta-error" id="error-general" hidden></p>

        <button type="submit" class="btn btn-primario btn-bloque" id="boton-entrar">Iniciar sesión</button>
        <button type="button" class="enlace" id="olvido">¿Olvidaste tu contraseña?</button>

      </form>

    </main>`;


  const formulario = raiz.querySelector('#form-login');
  const campoUsuario = raiz.querySelector('#usuario');
  const campoClave = raiz.querySelector('#clave');
  const errorGeneral = raiz.querySelector('#error-general');
  const botonEntrar = raiz.querySelector('#boton-entrar');


  /* ----- Ayudas para mostrar y limpiar errores ----- */

  function mostrarError(campo, mensaje) {
    raiz.querySelector(`#error-${campo}`).textContent = mensaje;
    raiz.querySelector(`#${campo}`).classList.add('con-error');
  }

  function limpiarErrores() {
    raiz.querySelectorAll('.campo-error').forEach((p) => { p.textContent = ''; });
    raiz.querySelectorAll('.campo').forEach((c) => c.classList.remove('con-error'));
    errorGeneral.hidden = true;
  }

  function mostrarErrorGeneral(mensaje) {
    botonEntrar.disabled = false;
    botonEntrar.textContent = 'Iniciar sesión';

    errorGeneral.textContent = mensaje;
    errorGeneral.hidden = false;

    campoClave.value = '';
    campoClave.focus();

    // Efecto visual de sacudida
    formulario.classList.remove('sacudir');
    void formulario.offsetWidth;
    formulario.classList.add('sacudir');
  }


  /* ----- Mostrar / ocultar contraseña ----- */

  raiz.querySelector('#ver-clave').addEventListener('click', () => {
    campoClave.type = campoClave.type === 'password' ? 'text' : 'password';
  });


  /* ----- Recuperar contraseña ----- */

  raiz.querySelector('#olvido').addEventListener('click', () => {
    mostrarToast('Pídele a un administrador que restablezca tu contraseña.');
  });


  /* ----- Enviar el formulario al backend ----- */

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limpiarErrores();

    const usuario = campoUsuario.value.trim();
    const clave = campoClave.value;
    let valido = true;

    // Validaciones básicas en el cliente antes de disparar la red
    if (!usuario) {
      mostrarError('usuario', 'Ingresa tu usuario.');
      valido = false;
    } else if (usuario.length < 3) {
      mostrarError('usuario', 'El usuario debe tener al menos 3 caracteres.');
      valido = false;
    }

    if (!clave) {
      mostrarError('clave', 'Ingresa tu contraseña.');
      valido = false;
    }

    if (!valido) return;

    // Deshabilitar botón para evitar múltiples peticiones
    botonEntrar.disabled = true;
    botonEntrar.textContent = 'Ingresando…';

    try {
      await iniciarSesion(usuario, clave);   // POST /api/auth/login
      await cargarDatos();                   // productos y pedidos desde Oracle
    } catch (error) {
      cerrarSesion();
      mostrarErrorGeneral(error.message);
      return;
    }

    location.hash = '#/inicio';
    mostrarToast(`¡Hola, ${estado.usuario.nombre.split(' ')[0]}!`);
  });
}
