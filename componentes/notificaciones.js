/* ==========================================================
   NOTIFICACIONES Y ALERTAS EN TIEMPO REAL (tarea #31)
   El navegador mantiene UNA conexión abierta con el servidor
   (Server-Sent Events) y recibe cada aviso apenas ocurre:
   pedido nuevo, pedido listo, stock bajo, pagos, etc.

   · Se muestra un mensaje flotante, suena un aviso (se puede apagar)
     y, si diste permiso, sale una notificación del navegador cuando
     la pestaña está en segundo plano.
   · Si se corta la conexión, reintenta sola y recupera lo que se perdió.
   · Funciona con la app abierta (no es "push" con la app cerrada).
   ========================================================== */

import { API_URL } from '../nucleo/config.js';
import { api, tokenActual } from '../nucleo/api.js';
import { abrirModal, esc, haceCuanto, mostrarToast } from '../nucleo/utilidades.js';


const MAX_AVISOS = 50;
const CLAVE_SONIDO = 'bajon.sonido';

const ICONO_AVISO = {
  pedido_nuevo: '🧾', pedido_listo: '✅', stock_bajo: '⚠️', stock_agotado: '🚫',
  pago_aprobado: '💳', pago_rechazado: '❌', pago_anulado: '↩️', fallo_reportado: '🐞', respaldo_fallido: '💾'
};

let avisos = [];            // el más nuevo primero
let noLeidos = 0;
let ultimoId = 0;
let activo = false;
let controlador = null;
let temporizador = null;
let intentos = 0;
let conectado = false;
let alAviso = null;
let contextoAudio = null;


/* ---------- Preferencias ---------- */

export function sonidoActivo() {
  try { return localStorage.getItem(CLAVE_SONIDO) !== '0'; } catch { return true; }
}

export function fijarSonido(activar) {
  try { localStorage.setItem(CLAVE_SONIDO, activar ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

export const permisoNavegador = () => (typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission);

export async function pedirPermisoNavegador() {
  if (typeof Notification === 'undefined') return 'no-soportado';
  return Notification.requestPermission();
}

export const estaConectado = () => conectado;


/* ---------- Efectos de un aviso nuevo ---------- */

function sonar() {
  if (!sonidoActivo()) return;

  try {
    contextoAudio = contextoAudio || new (window.AudioContext || window.webkitAudioContext)();
    if (contextoAudio.state === 'suspended') contextoAudio.resume();

    const oscilador = contextoAudio.createOscillator();
    const volumen = contextoAudio.createGain();

    oscilador.type = 'sine';
    oscilador.frequency.value = 880;
    volumen.gain.setValueAtTime(0.0001, contextoAudio.currentTime);
    volumen.gain.exponentialRampToValueAtTime(0.15, contextoAudio.currentTime + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, contextoAudio.currentTime + 0.35);

    oscilador.connect(volumen).connect(contextoAudio.destination);
    oscilador.start();
    oscilador.stop(contextoAudio.currentTime + 0.4);
  } catch { /* el navegador no permite sonido todavía: se ignora */ }
}

function notificarNavegador(aviso) {
  if (permisoNavegador() !== 'granted' || !document.hidden) return;

  try {
    new Notification(aviso.titulo, { body: aviso.mensaje, tag: `bajon-${aviso.id}` });
  } catch { /* algunos celulares exigen un service worker: se ignora */ }
}

export function actualizarInsigniaAvisos() {
  const insignia = document.getElementById('insignia-avisos');
  if (!insignia) return;

  insignia.textContent = noLeidos > 9 ? '9+' : noLeidos;
  insignia.hidden = noLeidos === 0;
}

function procesar(aviso, { silencioso = false } = {}) {
  if (aviso.id <= ultimoId) return;                 // ya se vio (por ejemplo, al reconectar)
  ultimoId = aviso.id;

  avisos.unshift(aviso);
  if (avisos.length > MAX_AVISOS) avisos.pop();

  if (!silencioso) {
    noLeidos += 1;
    actualizarInsigniaAvisos();
    mostrarToast(`${aviso.titulo}${aviso.mensaje ? ` · ${aviso.mensaje}` : ''}`, aviso.nivel === 'alerta' ? 'error' : 'ok');
    sonar();
    notificarNavegador(aviso);
  }

  if (alAviso) alAviso(aviso);
}


/* ---------- Conexión ---------- */

async function leerFlujo(respuesta) {
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let memoria = '';

  for (;;) {
    const { value, done } = await lector.read();
    if (done) return;

    memoria += decodificador.decode(value, { stream: true });

    let corte;
    while ((corte = memoria.indexOf('\n\n')) >= 0) {
      const bloque = memoria.slice(0, corte);
      memoria = memoria.slice(corte + 2);

      const linea = bloque.split('\n').find((l) => l.startsWith('data: '));
      if (!linea) continue;                         // "retry:" y los pings no traen datos

      try { procesar(JSON.parse(linea.slice(6))); } catch { /* aviso mal formado: se ignora */ }
    }
  }
}

async function conectar() {
  if (!activo) return;

  controlador = new AbortController();

  try {
    const respuesta = await fetch(`${API_URL}/api/notificaciones/flujo`, {
      headers: { Authorization: `Bearer ${tokenActual()}`, ...(ultimoId ? { 'Last-Event-ID': String(ultimoId) } : {}) },
      signal: controlador.signal
    });

    if (respuesta.status === 401) { detenerNotificaciones(); return; }
    if (!respuesta.ok || !respuesta.body) throw new Error('sin flujo');

    const eraReconexion = intentos > 0;
    conectado = true;
    intentos = 0;

    // Después de una caída pueden haber cambiado cosas: se avisa a la pantalla para que se actualice
    if (eraReconexion && alAviso) alAviso({ tipo: 'reconectado' });

    await leerFlujo(respuesta);
  } catch {
    /* se cortó o no hay red: se reintenta abajo */
  }

  conectado = false;
  if (!activo) return;

  intentos += 1;
  temporizador = setTimeout(conectar, Math.min(30000, 2000 * intentos));      // 2 s, 4 s, 6 s… hasta 30 s
}

export async function iniciarNotificaciones(callback) {
  if (activo) return;

  activo = true;
  alAviso = callback;

  try {
    const { data } = await api('/api/notificaciones');
    avisos = data;
    ultimoId = data.reduce((mayor, a) => Math.max(mayor, a.id), 0);
    noLeidos = 0;                                    // lo que ya existía al entrar no se cuenta como nuevo
  } catch { /* sin historial: igual se conecta */ }

  actualizarInsigniaAvisos();
  conectar();
}

export function detenerNotificaciones() {
  activo = false;
  conectado = false;
  clearTimeout(temporizador);
  if (controlador) controlador.abort();

  avisos = [];
  noLeidos = 0;
  ultimoId = 0;
  intentos = 0;
}


/* ---------- Lista de avisos ---------- */

export function abrirAvisos() {
  noLeidos = 0;
  actualizarInsigniaAvisos();

  const filas = avisos.map((a) => `
    <li class="aviso aviso-${esc(a.nivel)}">
      <span class="aviso-icono">${ICONO_AVISO[a.tipo] || '🔔'}</span>
      <div>
        <strong>${esc(a.titulo)}</strong>
        ${a.mensaje ? `<p>${esc(a.mensaje)}</p>` : ''}
        <small>${haceCuanto(new Date(a.fecha).getTime())}</small>
      </div>
    </li>`).join('');

  abrirModal(`
    <h2 class="modal-titulo">Avisos</h2>
    <p class="aviso-estado">${conectado ? '🟢 Recibiendo avisos en tiempo real' : '🟠 Reconectando…'}</p>
    <ul class="aviso-lista">${filas || '<li class="admin-vacio">Todavía no hay avisos.</li>'}</ul>
    <div class="modal-acciones"><button class="btn btn-primario" data-cerrar>Cerrar</button></div>
  `);
}
