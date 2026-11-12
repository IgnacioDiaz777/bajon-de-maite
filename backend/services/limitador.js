/* ==========================================================
   LIMITADOR DE INTENTOS (en memoria)
   Cuenta fallos por clave (ej. id de usuario) dentro de una ventana
   de tiempo y bloquea al pasarse. Se reinicia al apagar el servidor.
   ========================================================== */

import { ErrorApp } from './errores.js';


export function crearLimitador({ max, ventanaMs, ahora = () => Date.now() }) {
  const intentos = new Map();      // clave → [marcas de tiempo]

  const recientes = (clave) => (intentos.get(clave) || []).filter((t) => t > ahora() - ventanaMs);

  return {
    // Lanza 429 si ya hubo "max" fallos dentro de la ventana
    revisar(clave) {
      if (recientes(clave).length >= max) {
        throw new ErrorApp(429, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.');
      }
    },

    registrar(clave) {
      intentos.set(clave, [...recientes(clave), ahora()]);
    },

    reiniciar(clave) {
      if (clave === undefined) intentos.clear();
      else intentos.delete(clave);
    }
  };
}
