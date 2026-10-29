/* ==========================================================
   SECCIÓN: INICIO
   Resumen rápido, promo del día y los más pedidos.
   ========================================================== */

import { estado, buscarProducto, buscarProductoPorNombre, estadoStock, agregarAlBorrador, pedidosEnCocina, puede } from '../../nucleo/estado.js';
import { icono, esc, formatoPrecio, imagenProducto, mostrarToast } from '../../nucleo/utilidades.js';
import { cabeceraApp } from '../../componentes/cabecera.js';
import { abrirDetalleProducto } from '../../componentes/detalle-producto.js';
import { actualizarInsigniaPedidos } from '../../componentes/navegacion.js';


export function renderInicio(contenedor) {
  const promo = buscarProductoPorNombre(estado.inicio.promo.nombreProducto);
  const masPedidos = estado.inicio.masPedidos.map(buscarProductoPorNombre).filter(Boolean);

  const enCocina = pedidosEnCocina().length;
  const stockPorRevisar = estado.productos.filter((p) => estadoStock(p) !== 'disponible').length;


  contenedor.innerHTML = `
    ${cabeceraApp()}

    <p class="sobretitulo">TU ANTOJO, RECIÉN HECHO</p>
    <h1 class="titulo">¿Te dio el bajón?</h1>
    <p class="subtitulo">Acá lo resolvemos. Y con extra de sabor.</p>


    <div class="resumen">
      <a class="resumen-tarjeta" href="#/pedidos">
        <span>En cocina</span>
        <strong>${enCocina}</strong>
      </a>

      <a class="resumen-tarjeta" href="#/productos">
        <span>Stock por revisar</span>
        <strong>${stockPorRevisar}</strong>
      </a>
    </div>


    ${promo ? `
      <article class="promo" data-abrir="${promo.id}">
        <div class="promo-imagen">
          ${imagenProducto(promo, 'ancho')}
          <span class="promo-etiqueta">${esc(estado.inicio.promo.etiqueta)}</span>
        </div>

        <div class="promo-cuerpo">
          <div>
            <h2>${esc(promo.nombre)}</h2>
            <p>${esc(promo.resumen)}</p>
            <div class="promo-precios">
              <strong>${formatoPrecio(promo.precio)}</strong>
              <s>${formatoPrecio(estado.inicio.promo.precioAnterior)}</s>
            </div>
          </div>

          <span class="btn-redondo btn-grande" aria-label="Ver detalle">${icono('flecha', 20)}</span>
        </div>
      </article>` : ''}


    <div class="seccion-titulo">
      <h2>Los más pedidos</h2>
      <a href="#/productos">Ver todos →</a>
    </div>

    <div class="grilla-populares">
      ${masPedidos.map((p) => `
        <article class="popular" data-abrir="${p.id}">
          ${imagenProducto(p, 'ancho')}
          <h3>${esc(p.nombre)}</h3>
          <p>${esc(p.resumen)}</p>

          <div class="popular-pie">
            <strong>${formatoPrecio(p.precio)}</strong>
            ${puede('crearPedido') ? `<button class="btn-redondo" data-agregar="${p.id}" aria-label="Agregar ${esc(p.nombre)} al pedido">${icono('mas', 18)}</button>` : ''}
          </div>
        </article>`).join('')}
    </div>
  `;


  /* ----- Eventos ----- */

  contenedor.addEventListener('click', (evento) => {
    const botonAgregar = evento.target.closest('[data-agregar]');

    if (botonAgregar) {
      const producto = buscarProducto(Number(botonAgregar.dataset.agregar));

      if (estadoStock(producto) === 'agotado') {
        mostrarToast(`${producto.nombre} está agotado`, 'error');
        return;
      }

      agregarAlBorrador(producto.id, 1);
      actualizarInsigniaPedidos();
      mostrarToast(`${producto.nombre} agregado al pedido`);
      return;
    }

    const tarjeta = evento.target.closest('[data-abrir]');

    if (tarjeta) {
      abrirDetalleProducto(Number(tarjeta.dataset.abrir));
    }
  });
}
