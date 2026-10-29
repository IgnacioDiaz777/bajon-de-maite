/* ==========================================================
   DETALLE DE PRODUCTO
   Hoja con la información del plato, opción de combo,
   cantidad y botón "Agregar al pedido".
   ========================================================== */

import { buscarProducto, estadoStock, agregarAlBorrador, puede } from '../nucleo/estado.js';
import { abrirModal, icono, esc, formatoPrecio, imagenProducto, mostrarToast } from '../nucleo/utilidades.js';
import { actualizarInsigniaPedidos } from './navegacion.js';


const TEXTO_ESTADO = {
  disponible: 'Disponible',
  poco: 'Pocas unidades',
  agotado: 'Agotado'
};


export function abrirDetalleProducto(id) {
  const producto = buscarProducto(id);
  if (!producto) return;

  const estadoProducto = estadoStock(producto);
  const agotado = estadoProducto === 'agotado';
  const puedePedir = puede('crearPedido');
  let cantidad = 1;
  let combo = false;

  const { el, cerrar } = abrirModal(`
    <div class="detalle-barra">
      <button class="icono-btn" data-cerrar aria-label="Volver">${icono('atras')}</button>
      <strong>Hecha para tu antojo</strong>
      <button class="icono-btn" id="detalle-ir-pedido" aria-label="Ver pedido">${icono('bolsa')}</button>
    </div>

    <div class="detalle-imagen">
      ${imagenProducto(producto, 'grande')}
      ${producto.etiqueta ? `<span class="detalle-etiqueta">${esc(producto.etiqueta)}</span>` : ''}
    </div>

    <div class="detalle-fila">
      <span class="insignia insignia-${estadoProducto}">${TEXTO_ESTADO[estadoProducto]}</span>
      ${producto.rating ? `<span class="detalle-rating">★ <b>${producto.rating}</b> (${producto.resenas} reseñas)</span>` : ''}
    </div>

    <h2 class="detalle-nombre">${esc(producto.nombre)}</h2>
    <p class="detalle-precio">${formatoPrecio(producto.precio)}</p>
    <p class="detalle-descripcion">${esc(producto.descripcion || producto.resumen)}</p>

    <div class="detalle-meta">
      <span>${icono('reloj', 16)} ${esc(producto.tiempo || '10–15 min')}</span>
      <span>🔥 Hecha al momento</span>
    </div>

    ${producto.permiteCombo ? `
      <div class="detalle-combo">
        <div class="fila-combo-titulo"><h3>Más bajón, más sabor</h3><span>Opcional</span></div>
        <label class="combo-opcion">
          <input type="checkbox" id="detalle-combo">
          <span><b>Hazla combo</b><small>Papas clásicas + bebida de 350 ml</small></span>
          <b>+${formatoPrecio(producto.precioCombo)}</b>
        </label>
      </div>` : ''}

    <div class="detalle-pie">
      <div class="cantidad">
        <button id="detalle-menos" aria-label="Quitar uno">${icono('menos', 16)}</button>
        <span id="detalle-cantidad">1</span>
        <button id="detalle-mas" aria-label="Agregar uno">${icono('mas', 16)}</button>
      </div>

      <div class="detalle-subtotal"><small>Subtotal</small><strong id="detalle-subtotal"></strong></div>
    </div>

    <button class="btn btn-primario btn-bloque" id="detalle-agregar" ${agotado || !puedePedir ? 'disabled' : ''}>
      ${agotado ? 'Producto agotado' : (!puedePedir ? 'Tu rol no registra pedidos' : '')}
    </button>
  `);


  /* ----- Actualiza cantidad, subtotal y texto del botón ----- */

  function actualizar() {
    const unitario = producto.precio + (combo ? producto.precioCombo || 0 : 0);
    const subtotal = formatoPrecio(unitario * cantidad);

    el.querySelector('#detalle-cantidad').textContent = cantidad;
    el.querySelector('#detalle-subtotal').textContent = subtotal;
    el.querySelector('#detalle-menos').disabled = cantidad <= 1;

    if (!agotado && puedePedir) {
      el.querySelector('#detalle-agregar').innerHTML = `${icono('mas', 18)} Agregar al pedido · ${subtotal}`;
    }
  }


  /* ----- Eventos ----- */

  el.querySelector('#detalle-menos').addEventListener('click', () => {
    if (cantidad > 1) cantidad -= 1;
    actualizar();
  });

  el.querySelector('#detalle-mas').addEventListener('click', () => {
    if (cantidad >= producto.stock) {
      mostrarToast(agotado ? 'Este producto está agotado' : `Solo quedan ${producto.stock} unidades`, 'error');
      return;
    }

    cantidad += 1;
    actualizar();
  });

  const casillaCombo = el.querySelector('#detalle-combo');

  if (casillaCombo) {
    casillaCombo.addEventListener('change', () => {
      combo = casillaCombo.checked;
      actualizar();
    });
  }

  el.querySelector('#detalle-ir-pedido').addEventListener('click', () => {
    cerrar();
    location.hash = '#/pedidos';
  });

  el.querySelector('#detalle-agregar').addEventListener('click', () => {
    agregarAlBorrador(producto.id, cantidad, combo);
    actualizarInsigniaPedidos();
    mostrarToast(`${cantidad} × ${producto.nombre} agregado al pedido`);
    cerrar();
  });

  actualizar();
}
