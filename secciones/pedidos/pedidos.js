/* ==========================================================
   SECCIÓN: PEDIDOS
   Crear un pedido, enviarlo a cocina y seguir su estado.
   Los pedidos se registran en Oracle (SP_CREAR_PEDIDO) y la
   lista "En cocina" se lee desde las tablas PEDIDO y
   DETALLE_PEDIDO.
   ========================================================== */

import {
  estado, buscarProducto, estadoStock, precioItem, agregarAlBorrador, cantidadEnBorrador,
  cambiarCantidad, totalProductosBorrador, totalBorrador, enviarPedido, avanzarPedido, pedidosEnCocina, puede
} from '../../nucleo/estado.js';
import { abrirModal, icono, esc, formatoPrecio, numeroPedido, haceCuanto, imagenProducto, mostrarToast } from '../../nucleo/utilidades.js';
import { actualizarInsigniaPedidos } from '../../componentes/navegacion.js';


const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const TIPOS_ENTREGA = ['Para llevar', 'Mesa 01', 'Mesa 02', 'Mesa 03', 'Mesa 04', 'Mesa 05'];

const CLASE_ESTADO = {
  'En preparación': 'estado-preparacion',
  'Listo para retirar': 'estado-listo'
};

// Qué botón se muestra según el estado y qué permiso necesita
const ACCION_POR_ESTADO = {
  'En preparación': { texto: 'Marcar como listo', permiso: 'marcarListo' },
  'Listo para retirar': { texto: 'Marcar como entregado', permiso: 'marcarEntregado' }
};


/* ---------- Render principal ---------- */

export function renderPedidos(contenedor) {
  const borrador = estado.borrador;
  const enCocina = pedidosEnCocina();
  const productosEnCocina = enCocina.reduce((suma, p) => suma + p.items.reduce((s, i) => s + i.cantidad, 0), 0);
  const puedeCrear = puede('crearPedido');

  contenedor.innerHTML = `
    <h1 class="titulo">Pedidos</h1>
    <p class="subtitulo">Del antojo a la cocina. Sin vueltas.</p>


    ${puedeCrear ? `
    <!-- ===== Nuevo pedido ===== -->
    <section class="tarjeta-pedido">

      <div class="fila-entre">
        <h2>Nuevo pedido</h2>
        <span class="etiqueta-borrador">BORRADOR</span>
      </div>

      <div class="fila-campos">
        <label class="campo-blanco">
          ${icono('usuario', 16)}
          <input id="cliente" maxlength="40" placeholder="Nombre del cliente" value="${esc(borrador.cliente)}">
        </label>

        <select id="tipo" class="selector" aria-label="Tipo de entrega">
          ${TIPOS_ENTREGA.map((t) => `<option ${t === borrador.tipo ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <p class="campo-error" id="error-cliente"></p>


      ${borrador.items.length === 0
        ? '<p class="items-vacio">Aún no agregas productos a este pedido.</p>'
        : `<ul class="items-pedido">${borrador.items.map(itemHTML).join('')}</ul>`}

      <button class="enlace-amarillo" id="agregar-productos">${icono('mas', 14)} Agregar productos</button>

      <label class="campo-blanco">
        ${icono('mensaje', 16)}
        <input id="nota" maxlength="200" placeholder="Nota al cocinero: ej. pan fresco" value="${esc(borrador.nota)}">
      </label>


      <div class="totales">
        <div>
          <small>Cantidad total</small>
          <strong>${plural(totalProductosBorrador(), 'producto', 'productos')}</strong>
        </div>

        <div class="total-derecha">
          <small>Total del pedido</small>
          <strong class="total-grande">${formatoPrecio(totalBorrador())}</strong>
        </div>
      </div>

      <p class="alerta-error" id="error-pedido" hidden></p>

      <button class="btn btn-primario btn-bloque" id="enviar">${icono('enviar', 18)} Registrar y enviar a cocina</button>

    </section>` : `
    <p class="items-vacio">Tu rol (${esc(estado.usuario.rol)}) no registra pedidos nuevos. Aquí puedes seguir la cocina.</p>`}


    <!-- ===== En cocina ===== -->
    <div class="seccion-titulo">
      <h2>En cocina</h2>
      <span class="resumen-cocina">${plural(enCocina.length, 'pedido', 'pedidos')} · ${plural(productosEnCocina, 'producto', 'productos')}</span>
    </div>

    ${enCocina.length === 0
      ? '<p class="items-vacio">No hay pedidos en cocina por ahora.</p>'
      : `<div class="lista-cocina">${enCocina.map(pedidoHTML).join('')}</div>`}
  `;


  if (puedeCrear) enlazarFormulario(contenedor);


  /* ----- Avanzar estado de un pedido en cocina ----- */

  contenedor.querySelectorAll('[data-avanzar]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      boton.disabled = true;

      try {
        const pedido = await avanzarPedido(Number(boton.dataset.avanzar));

        mostrarToast(pedido.estado === 'Entregado'
          ? `Pedido ${numeroPedido(pedido.numero)} entregado`
          : `Pedido ${numeroPedido(pedido.numero)} listo para retirar`);
      } catch (error) {
        mostrarToast(error.message, 'error');
      }

      renderPedidos(contenedor);
    });
  });
}


/* ---------- Formulario del pedido nuevo ---------- */

function enlazarFormulario(contenedor) {
  const borrador = estado.borrador;

  /* ----- Campos del borrador (se guardan sin volver a pintar) ----- */

  contenedor.querySelector('#cliente').addEventListener('input', (e) => { borrador.cliente = e.target.value; });
  contenedor.querySelector('#tipo').addEventListener('change', (e) => { borrador.tipo = e.target.value; });
  contenedor.querySelector('#nota').addEventListener('input', (e) => { borrador.nota = e.target.value; });


  /* ----- Cantidades ----- */

  contenedor.querySelectorAll('[data-menos], [data-mas]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const esMas = boton.hasAttribute('data-mas');
      const indice = Number(esMas ? boton.dataset.mas : boton.dataset.menos);
      const item = borrador.items[indice];

      if (esMas && cantidadEnBorrador(item.idProducto) >= buscarProducto(item.idProducto).stock) {
        mostrarToast('No hay más stock de este producto', 'error');
        return;
      }

      cambiarCantidad(indice, esMas ? 1 : -1);
      actualizarInsigniaPedidos();
      renderPedidos(contenedor);
    });
  });


  /* ----- Agregar productos ----- */

  contenedor.querySelector('#agregar-productos').addEventListener('click', () => {
    abrirSelector(() => renderPedidos(contenedor));
  });


  /* ----- Enviar a cocina ----- */

  const botonEnviar = contenedor.querySelector('#enviar');

  botonEnviar.addEventListener('click', async () => {
    contenedor.querySelector('#error-cliente').textContent = '';
    const alerta = contenedor.querySelector('#error-pedido');
    alerta.hidden = true;

    botonEnviar.disabled = true;
    botonEnviar.textContent = 'Enviando…';

    const resultado = await enviarPedido();

    if (!resultado.ok) {
      botonEnviar.disabled = false;
      botonEnviar.innerHTML = `${icono('enviar', 18)} Registrar y enviar a cocina`;

      if (resultado.campo === 'cliente') {
        contenedor.querySelector('#error-cliente').textContent = resultado.error;
      } else {
        alerta.textContent = resultado.error;
        alerta.hidden = false;
      }
      return;
    }

    actualizarInsigniaPedidos();
    mostrarToast(`Pedido ${numeroPedido(resultado.pedido.numero)} enviado a cocina`);
    renderPedidos(contenedor);
  });
}


/* ---------- Piezas de HTML ---------- */

function itemHTML(item, indice) {
  const producto = buscarProducto(item.idProducto);

  return `
    <li class="item-pedido">
      ${imagenProducto(producto, 'mini')}

      <div class="item-info">
        <strong>${esc(producto.nombre)}${item.combo ? ' (combo)' : ''}</strong>
        <small>${formatoPrecio(precioItem(item))} c/u</small>
      </div>

      <div class="cantidad">
        <button data-menos="${indice}" aria-label="Quitar uno">${icono('menos', 14)}</button>
        <span>${item.cantidad}</span>
        <button data-mas="${indice}" aria-label="Agregar uno">${icono('mas', 14)}</button>
      </div>
    </li>`;
}

function pedidoHTML(pedido) {
  const resumen = pedido.items.map((i) => `${i.cantidad} × ${esc(i.nombre)}`).join(' · ');
  const accion = ACCION_POR_ESTADO[pedido.estado];

  return `
    <article class="pedido-cocina">
      <div class="fila-entre">
        <div>
          <strong class="pedido-numero">${numeroPedido(pedido.numero)}</strong>
          <span class="pedido-destino">${esc(pedido.destino)} · ${esc(pedido.cliente)}</span>
        </div>

        <span class="estado ${CLASE_ESTADO[pedido.estado] || ''}">${esc(pedido.estado)}</span>
      </div>

      <div class="fila-entre">
        <p class="pedido-items">${resumen}</p>
        <span class="pedido-hace">${haceCuanto(pedido.creado)}</span>
      </div>

      ${pedido.nota ? `<p class="pedido-nota">Nota: ${esc(pedido.nota)}</p>` : ''}

      ${accion && puede(accion.permiso)
        ? `<button class="btn-avanzar" data-avanzar="${pedido.numero}">${accion.texto}</button>`
        : ''}
    </article>`;
}


/* ---------- Selector de productos ---------- */

function abrirSelector(alCerrar) {
  const filas = estado.productos.map((p) => {
    const agotado = estadoStock(p) === 'agotado';

    return `
      <li class="selector-fila">
        ${imagenProducto(p, 'mini')}

        <div class="item-info">
          <strong>${esc(p.nombre)}</strong>
          <small>${formatoPrecio(p.precio)} · ${agotado ? 'Agotado' : `${p.stock} uds.`}</small>
        </div>

        <span class="selector-cuenta" id="cuenta-${p.id}" ${cantidadEnBorrador(p.id) ? '' : 'hidden'}>×${cantidadEnBorrador(p.id)}</span>
        <button class="btn-redondo" data-sumar="${p.id}" ${agotado ? 'disabled' : ''} aria-label="Agregar ${esc(p.nombre)}">${icono('mas', 16)}</button>
      </li>`;
  }).join('');

  const { el } = abrirModal(`
    <h2 class="modal-titulo">Agregar productos</h2>
    <ul class="selector-lista">${filas || '<li class="items-vacio">No hay productos en el menú.</li>'}</ul>
    <div class="modal-acciones">
      <button class="btn btn-primario" data-cerrar>Listo</button>
    </div>
  `, { alCerrar });

  el.querySelectorAll('[data-sumar]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const producto = buscarProducto(Number(boton.dataset.sumar));

      if (cantidadEnBorrador(producto.id) >= producto.stock) {
        mostrarToast(`Solo quedan ${producto.stock} de ${producto.nombre}`, 'error');
        return;
      }

      agregarAlBorrador(producto.id, 1);
      actualizarInsigniaPedidos();

      const cuenta = el.querySelector(`#cuenta-${producto.id}`);
      cuenta.textContent = `×${cantidadEnBorrador(producto.id)}`;
      cuenta.hidden = false;
    });
  });
}
