/* ==========================================================
   SECCIÓN: PRODUCTOS
   Búsqueda, filtros por estado, listado, edición y
   botón "Añadir plato". Los datos viven en la tabla PRODUCTO
   de Oracle (se leen y guardan a través de la API).
   ========================================================== */

import { estado, estadoStock, guardarProducto, eliminarProducto, puede } from '../../nucleo/estado.js';
import { abrirModal, icono, esc, formatoPrecio, imagenProducto, mostrarToast } from '../../nucleo/utilidades.js';
import { cabeceraApp } from '../../componentes/cabecera.js';


/* ---------- Opciones de orden ---------- */

const ORDENES = [
  { etiqueta: 'Más recientes', comparar: (a, b) => b.id - a.id },
  { etiqueta: 'Nombre (A-Z)', comparar: (a, b) => a.nombre.localeCompare(b.nombre, 'es') },
  { etiqueta: 'Precio (menor)', comparar: (a, b) => a.precio - b.precio },
  { etiqueta: 'Precio (mayor)', comparar: (a, b) => b.precio - a.precio }
];

const TEXTO_STOCK = {
  disponible: (p) => `Disponible · ${p.stock} uds.`,
  poco: (p) => `Pocas unidades · ${p.stock} uds.`,
  agotado: () => 'Agotado · 0 uds.'
};

// Valores permitidos por la restricción CHK_CAT_PROD de la tabla PRODUCTO
const CATEGORIAS = [
  { valor: 'COMIDA', etiqueta: 'Plato (comida)' },
  { valor: 'BEBIDA', etiqueta: 'Bebida' },
  { valor: 'POSTRE', etiqueta: 'Postre' },
  { valor: 'OTRO', etiqueta: 'Extra / otro' }
];


/* ---------- Estado de la vista (se mantiene al cambiar de pestaña) ---------- */

const vista = { busqueda: '', filtro: 'todos', orden: 0 };

let contenedor = null;


/* ---------- Render principal ---------- */

export function renderProductos(raiz) {
  contenedor = raiz;

  contenedor.innerHTML = `
    ${cabeceraApp()}

    <h1 class="titulo">Productos</h1>
    <p class="subtitulo">Tu menú, siempre al día.</p>

    <div class="buscador">
      <span class="buscador-icono">${icono('buscar', 20)}</span>
      <input id="buscar" type="search" placeholder="Buscar un producto" value="${esc(vista.busqueda)}">
      <button id="cambiar-orden" aria-label="Cambiar orden">${icono('filtros', 20)}</button>
    </div>

    <div id="zona-lista"></div>

    ${puede('gestionarProductos') ? `
      <div class="barra-accion">
        <button class="btn btn-primario btn-bloque" id="anadir-plato">${icono('mas', 18)} Añadir plato</button>
      </div>` : ''}
  `;

  contenedor.querySelector('#buscar').addEventListener('input', (e) => {
    vista.busqueda = e.target.value;
    pintarLista();
  });

  contenedor.querySelector('#cambiar-orden').addEventListener('click', cambiarOrden);

  const botonAnadir = contenedor.querySelector('#anadir-plato');
  if (botonAnadir) botonAnadir.addEventListener('click', () => abrirFormulario(null));

  contenedor.querySelector('#zona-lista').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filtro]');
    const editar = e.target.closest('[data-editar]');

    if (chip) {
      vista.filtro = chip.dataset.filtro;
      pintarLista();
    } else if (editar) {
      abrirFormulario(estado.productos.find((p) => p.id === Number(editar.dataset.editar)));
    } else if (e.target.closest('[data-orden]')) {
      cambiarOrden();
    } else if (e.target.closest('[data-limpiar]')) {
      vista.busqueda = '';
      vista.filtro = 'todos';
      contenedor.querySelector('#buscar').value = '';
      pintarLista();
    }
  });

  pintarLista();
}


function cambiarOrden() {
  vista.orden = (vista.orden + 1) % ORDENES.length;
  pintarLista();
  mostrarToast(`Orden: ${ORDENES[vista.orden].etiqueta}`);
}


/* ---------- Lista (filtros + platos + extras) ---------- */

const esPlato = (producto) => producto.categoria === 'COMIDA';

function pintarLista() {
  const platos = estado.productos.filter(esPlato);

  const contadores = {
    todos: platos.length,
    disponibles: platos.filter((p) => estadoStock(p) === 'disponible').length,
    agotados: platos.filter((p) => estadoStock(p) === 'agotado').length
  };

  const cumple = (p) => {
    const coincide = p.nombre.toLowerCase().includes(vista.busqueda.trim().toLowerCase());
    const estadoProducto = estadoStock(p);

    if (vista.filtro === 'disponibles') return coincide && estadoProducto === 'disponible';
    if (vista.filtro === 'agotados') return coincide && estadoProducto === 'agotado';
    return coincide;
  };

  const ordenar = ORDENES[vista.orden].comparar;
  const platosVisibles = platos.filter(cumple).sort(ordenar);
  const extrasVisibles = estado.productos.filter((p) => !esPlato(p)).filter(cumple).sort(ordenar);

  const chip = (clave, texto) => `
    <button class="chip ${vista.filtro === clave ? 'activo' : ''}" data-filtro="${clave}">
      ${texto} ${contadores[clave]}
    </button>`;

  const vacio = platosVisibles.length === 0 && extrasVisibles.length === 0;

  contenedor.querySelector('#zona-lista').innerHTML = `
    <div class="chips">
      ${chip('todos', 'Todos')}
      ${chip('disponibles', 'Disponibles')}
      ${chip('agotados', 'Agotados')}
    </div>

    <div class="lista-cabecera">
      <span>${platosVisibles.length} platos</span>
      <button data-orden>${ORDENES[vista.orden].etiqueta} ↓</button>
    </div>

    ${vacio ? `
      <div class="vacio">
        <p>${estado.productos.length ? 'No encontramos productos con esos filtros.' : 'Todavía no hay productos en el menú.'}</p>
        ${estado.productos.length ? '<button class="btn btn-secundario" data-limpiar>Limpiar filtros</button>' : ''}
      </div>` : ''}

    <ul class="lista-productos">${platosVisibles.map(filaProducto).join('')}</ul>

    ${extrasVisibles.length ? `
      <div class="extras-titulo">
        <h2>Extras</h2>
        <p>¿Algo para acompañar?</p>
      </div>
      <ul class="lista-productos">${extrasVisibles.map(filaProducto).join('')}</ul>` : ''}
  `;
}


function filaProducto(producto) {
  const estadoProducto = estadoStock(producto);

  return `
    <li class="fila-producto">
      ${imagenProducto(producto)}

      <div class="fila-info">
        <h3>${esc(producto.nombre)}</h3>
        <p>${formatoPrecio(producto.precio)}</p>
        <span class="insignia insignia-${estadoProducto}">${TEXTO_STOCK[estadoProducto](producto)}</span>
      </div>

      ${puede('gestionarProductos') ? `
        <button class="btn-editar" data-editar="${producto.id}" aria-label="Editar ${esc(producto.nombre)}">
          ${icono('editar', 20)}
          <span>Editar</span>
        </button>` : ''}
    </li>`;
}


/* ---------- Formulario: añadir / editar ---------- */

function abrirFormulario(producto) {
  const esNuevo = !producto;
  let confirmandoEliminar = false;

  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">${esNuevo ? 'Añadir plato' : 'Editar producto'}</h2>

    <div class="campo-grupo">
      <label for="f-nombre">Nombre</label>
      <input class="campo" id="f-nombre" maxlength="50" placeholder="Ej: Completo italiano" value="${esNuevo ? '' : esc(producto.nombre)}">
    </div>

    <div class="campo-grupo">
      <label for="f-descripcion">Descripción (opcional)</label>
      <input class="campo" id="f-descripcion" maxlength="150" placeholder="Ej: Cheddar + tocino crujiente" value="${esNuevo ? '' : esc(producto.descripcion)}">
    </div>

    <div class="formulario-doble">
      <div class="campo-grupo">
        <label for="f-precio">Precio ($)</label>
        <input class="campo" id="f-precio" type="number" min="0" inputmode="numeric" value="${esNuevo ? '' : producto.precio}">
      </div>

      <div class="campo-grupo">
        <label for="f-stock">Stock (uds.)</label>
        <input class="campo" id="f-stock" type="number" min="0" inputmode="numeric" value="${esNuevo ? '' : producto.stock}">
      </div>
    </div>

    <div class="campo-grupo">
      <label for="f-categoria">Categoría</label>
      <select class="campo" id="f-categoria">
        ${CATEGORIAS.map((c) => `<option value="${c.valor}" ${!esNuevo && producto.categoria === c.valor ? 'selected' : ''}>${c.etiqueta}</option>`).join('')}
      </select>
    </div>

    <p class="alerta-error" id="f-error" hidden></p>

    <div class="modal-acciones">
      <button class="btn btn-primario" id="f-guardar">${esNuevo ? 'Añadir al menú' : 'Guardar cambios'}</button>
      <button class="btn btn-secundario" data-cerrar>Cancelar</button>
      ${esNuevo ? '' : '<button class="btn btn-peligro" id="f-eliminar">Eliminar producto</button>'}
    </div>
  `);

  const error = el.querySelector('#f-error');
  const botonGuardar = el.querySelector('#f-guardar');
  const botonEliminar = el.querySelector('#f-eliminar');

  function mostrarError(mensaje) {
    error.textContent = mensaje;
    error.hidden = false;
    botonGuardar.disabled = false;
    if (botonEliminar) botonEliminar.disabled = false;
  }


  /* ----- Guardar (el backend vuelve a validar y escribe en Oracle) ----- */

  botonGuardar.addEventListener('click', async () => {
    const nombre = el.querySelector('#f-nombre').value.trim();
    const descripcion = el.querySelector('#f-descripcion').value.trim();
    const precio = Number(el.querySelector('#f-precio').value);
    const stockTexto = el.querySelector('#f-stock').value;
    const stock = Number(stockTexto);
    const categoria = el.querySelector('#f-categoria').value;

    // Validaciones previas en el cliente
    if (nombre.length < 3) return mostrarError('El nombre debe tener al menos 3 caracteres.');
    if (!Number.isInteger(precio) || precio < 100) return mostrarError('El precio debe ser un monto entero de $100 o más.');
    if (stockTexto === '' || !Number.isInteger(stock) || stock < 0) return mostrarError('El stock debe ser un número entero, 0 o más.');

    error.hidden = true;
    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando…';

    try {
      await guardarProducto({ nombre, descripcion, precio, stock, categoria }, esNuevo ? null : producto.id);
    } catch (err) {
      botonGuardar.textContent = esNuevo ? 'Añadir al menú' : 'Guardar cambios';
      return mostrarError(err.message);
    }

    cerrar();
    pintarLista();
    mostrarToast(esNuevo ? `"${nombre}" añadido al menú` : 'Cambios guardados');
  });


  /* ----- Eliminar (pide confirmación) ----- */

  if (botonEliminar) {
    botonEliminar.addEventListener('click', async () => {
      if (!confirmandoEliminar) {
        confirmandoEliminar = true;
        botonEliminar.textContent = '¿Seguro? Toca de nuevo para eliminar';
        return;
      }

      botonEliminar.disabled = true;

      try {
        await eliminarProducto(producto.id);
      } catch (err) {
        confirmandoEliminar = false;
        botonEliminar.textContent = 'Eliminar producto';
        return mostrarError(err.message);
      }

      cerrar();
      pintarLista();
      mostrarToast(`"${producto.nombre}" eliminado`);
    });
  }
}
