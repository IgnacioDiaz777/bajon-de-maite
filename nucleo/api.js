/* ==========================================================
   CLIENTE DE LA API
   Todas las llamadas al backend pasan por aquí: agrega el token
   de sesión, traduce los errores a mensajes claros y avisa
   cuando la sesión venció.
   ========================================================== */

import { API_URL } from './config.js';


let token = null;
let alSesionExpirada = null;


export function fijarToken(nuevoToken) {
  token = nuevoToken;
}

export function cuandoExpireLaSesion(callback) {
  alSesionExpirada = callback;
}


export class ErrorApi extends Error {
  constructor(mensaje, estado = 0) {
    super(mensaje);
    this.estado = estado;
  }
}


export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  let respuesta;

  try {
    respuesta = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor. Revisa que el backend esté encendido (npm start).');
  }

  let datos = {};

  try {
    datos = await respuesta.json();
  } catch { /* respuesta sin cuerpo */ }

  if (!respuesta.ok) {
    const sesionVencida = respuesta.status === 401 && token;

    if (sesionVencida && alSesionExpirada) alSesionExpirada();

    throw new ErrorApi((datos.errors || ['Ocurrió un error. Inténtalo nuevamente.']).join(' '), respuesta.status);
  }

  return datos;
}
