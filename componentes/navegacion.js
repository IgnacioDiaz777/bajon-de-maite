/* ==========================================================
   BARRA DE NAVEGACIÓN INFERIOR
   ========================================================== */

import { totalProductosBorrador } from '../nucleo/estado.js';
import { icono } from '../nucleo/utilidades.js';


const ITEMS = [
  { ruta: 'inicio', etiqueta: 'Inicio', icono: 'inicio' },
  { ruta: 'productos', etiqueta: 'Productos', icono: 'productos' },
  { ruta: 'pedidos', etiqueta: 'Pedidos', icono: 'pedidos' },
  { ruta: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes' }
];


export function renderNavegacion(rutaActiva) {
  const enlaces = ITEMS.map((item) => `
    <a class="nav-item ${item.ruta === rutaActiva ? 'activo' : ''}" href="#/${item.ruta}">
      <span class="nav-icono">
        ${icono(item.icono, 22)}
        ${item.ruta === 'pedidos' ? '<span class="nav-insignia" id="insignia-pedidos" hidden></span>' : ''}
      </span>
      <span>${item.etiqueta}</span>
    </a>`).join('');

  setTimeout(actualizarInsigniaPedidos, 0);

  return `<nav class="nav">${enlaces}</nav>`;
}


/* Muestra cuántos productos hay en el pedido en borrador */
export function actualizarInsigniaPedidos() {
  const insignia = document.getElementById('insignia-pedidos');
  if (!insignia) return;

  const cantidad = totalProductosBorrador();

  insignia.textContent = cantidad;
  insignia.hidden = cantidad === 0;
}
