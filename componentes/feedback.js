/* ==========================================================
   FEEDBACK Y REPORTE DE FALLOS (Sprint 4 · #28)
   · abrirFeedback(): ventana para enviar un comentario, una
     sugerencia o un reporte de fallo (cualquier rol).
   · reportarFalloAutomatico(): si la app tiene un error de
     JavaScript, lo envía sola (máximo 1 cada 30 segundos y sin
     repetir el mismo error).
   ========================================================== */

import { api } from '../nucleo/api.js';
import { estado } from '../nucleo/estado.js';
import { abrirModal, esc, mostrarToast } from '../nucleo/utilidades.js';


export function abrirFeedback(tipoInicial = 'FALLO') {
  const pantalla = location.hash.replace('#/', '') || 'inicio';

  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">Enviar comentario o reporte</h2>

    <div class="alerta-error" id="fb-error" hidden></div>

    <div class="campo-grupo">
      <label for="fb-tipo">¿Qué quieres contarnos?</label>
      <select class="campo" id="fb-tipo">
        <option value="FALLO" ${tipoInicial === 'FALLO' ? 'selected' : ''}>Algo no funciona (fallo)</option>
        <option value="SUGERENCIA" ${tipoInicial === 'SUGERENCIA' ? 'selected' : ''}>Una idea o sugerencia</option>
        <option value="COMENTARIO" ${tipoInicial === 'COMENTARIO' ? 'selected' : ''}>Un comentario</option>
      </select>
    </div>

    <div class="campo-grupo" id="fb-grupo-gravedad">
      <label for="fb-gravedad">¿Qué tan grave es?</label>
      <select class="campo" id="fb-gravedad">
        <option value="BAJA">Baja: puedo seguir trabajando</option>
        <option value="MEDIA" selected>Media: me complica el trabajo</option>
        <option value="ALTA">Alta: no puedo trabajar</option>
      </select>
    </div>

    <div class="campo-grupo">
      <label for="fb-titulo">Título corto</label>
      <input class="campo" id="fb-titulo" maxlength="100" placeholder="Ej: No carga la lista de pedidos">
    </div>

    <div class="campo-grupo">
      <label for="fb-descripcion">Cuéntanos qué pasó</label>
      <textarea class="campo campo-area" id="fb-descripcion" maxlength="1000" placeholder="¿Qué estabas haciendo? ¿Qué esperabas que pasara?"></textarea>
      <small class="campo-ayuda">Pantalla actual: ${esc(pantalla)}</small>
    </div>

    <div class="modal-acciones">
      <button class="btn btn-primario btn-bloque" id="fb-enviar">Enviar</button>
      <button class="btn btn-secundario btn-bloque" data-cerrar>Cancelar</button>
    </div>
  `);

  const tipo = el.querySelector('#fb-tipo');
  const grupoGravedad = el.querySelector('#fb-grupo-gravedad');
  const error = el.querySelector('#fb-error');
  const boton = el.querySelector('#fb-enviar');

  const actualizarGravedad = () => { grupoGravedad.hidden = tipo.value !== 'FALLO'; };
  tipo.addEventListener('change', actualizarGravedad);
  actualizarGravedad();

  boton.addEventListener('click', async () => {
    error.hidden = true;
    boton.disabled = true;

    try {
      await api('/api/feedback', {
        metodo: 'POST',
        cuerpo: {
          tipo: tipo.value,
          gravedad: el.querySelector('#fb-gravedad').value,
          titulo: el.querySelector('#fb-titulo').value,
          descripcion: el.querySelector('#fb-descripcion').value,
          pantalla
        }
      });

      cerrar();
      mostrarToast('¡Gracias! Recibimos tu reporte.');
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      boton.disabled = false;
    }
  });
}


/* ---------- Reporte automático de errores de la pantalla ---------- */

let ultimoEnvio = 0;
const yaEnviados = new Set();

export async function reportarFalloAutomatico(mensaje) {
  const texto = String(mensaje || 'Error desconocido').slice(0, 500);

  if (!estado.usuario) return;                          // sin sesión no hay a quién asociarlo
  if (yaEnviados.has(texto)) return;                    // el mismo error no se repite
  if (Date.now() - ultimoEnvio < 30000) return;         // y no más de uno cada 30 segundos

  ultimoEnvio = Date.now();
  yaEnviados.add(texto);

  try {
    await api('/api/feedback', {
      metodo: 'POST',
      cuerpo: {
        tipo: 'FALLO',
        gravedad: 'MEDIA',
        titulo: 'Error automático en la pantalla',
        descripcion: texto,
        pantalla: (location.hash.replace('#/', '') || 'inicio').slice(0, 30),
        origen: 'AUTOMATICO'
      }
    });
  } catch { /* si no se puede enviar, no pasa nada: nunca debe causar otro error */ }
}
