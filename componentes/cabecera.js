/* ==========================================================
   CABECERA DE LA APP (logo del local + avatar de la usuaria)
   ========================================================== */

import { estado } from '../nucleo/estado.js';
import { icono, esc } from '../nucleo/utilidades.js';


export function cabeceraApp() {
  return `
    <header class="cabecera">
      <a class="cabecera-marca" href="#/inicio">
        <span class="logo">${icono('tienda', 18)}</span>
        <span>El bajón de Maite</span>
      </a>

      <a class="avatar" href="#/ajustes" aria-label="Ir a ajustes">${esc(estado.usuario.iniciales)}</a>
    </header>`;
}
