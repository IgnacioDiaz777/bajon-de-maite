/* ==========================================================
   SECCIÓN: CLIENTES (tarea #33)
   Perfiles de clientes (teléfono, correo, notas) y sus direcciones
   de despacho. También se usa desde Pedidos para elegir a quién
   se le despacha: abrirSelectorCliente().
   ========================================================== */

import { api } from '../../nucleo/api.js';
import { puede } from '../../nucleo/estado.js';
import { abrirModal, esc, icono, mostrarToast } from '../../nucleo/utilidades.js';


const resumen = (d) => [`${d.calle} ${d.numero}`, d.depto ? `depto ${d.depto}` : '', d.comuna].filter(Boolean).join(', ');

let buscarTexto = '';
let esperaBusqueda = null;


/* ---------- Pantalla principal ---------- */

export function renderClientes(raiz) {
  raiz.innerHTML = `
    <a class="enlace-atras" href="#/ajustes">${icono('atras', 18)} Ajustes</a>
    <h1 class="titulo">Clientes</h1>
    <p class="subtitulo">Perfiles y direcciones de despacho.</p>

    <label class="campo-blanco">
      ${icono('buscar', 16)}
      <input id="cli-buscar" placeholder="Buscar por nombre o teléfono" value="${esc(buscarTexto)}" maxlength="40">
    </label>

    <button class="btn btn-primario btn-bloque cli-nuevo" id="cli-nuevo">${icono('mas', 18)} Nuevo cliente</button>

    <div id="cli-lista"><p class="admin-vacio">Cargando…</p></div>
  `;

  const lista = raiz.querySelector('#cli-lista');
  const cargar = () => cargarLista(lista, (c) => abrirFicha(c.id, { alCambiar: cargar }));

  raiz.querySelector('#cli-buscar').addEventListener('input', (e) => {
    buscarTexto = e.target.value;
    clearTimeout(esperaBusqueda);
    esperaBusqueda = setTimeout(cargar, 250);          // espera a que termine de escribir
  });

  raiz.querySelector('#cli-nuevo').addEventListener('click', () => abrirFicha(null, { alCambiar: cargar }));

  cargar();
}

async function cargarLista(lista, alElegir) {
  try {
    const consulta = buscarTexto.trim() ? `?buscar=${encodeURIComponent(buscarTexto.trim())}` : '';
    const { data } = await api(`/api/clientes${consulta}`);

    lista.innerHTML = data.length ? `<ul class="admin-lista cli-lista">${data.map(clienteHTML).join('')}</ul>` : '<p class="admin-vacio">No hay clientes con ese nombre.</p>';

    lista.querySelectorAll('[data-cliente]').forEach((fila) => {
      fila.addEventListener('click', () => alElegir(data.find((c) => c.id === Number(fila.dataset.cliente))));
    });
  } catch (error) {
    lista.innerHTML = `<div class="alerta-error">${esc(error.message)}</div>`;
  }
}

const clienteHTML = (c) => `
  <li>
    <button class="admin-item cli-fila" data-cliente="${c.id}">
      <div class="admin-item-cab">
        <strong>${esc(c.nombre)}</strong>
        <span class="admin-etiqueta etiqueta-neutra">${c.cantidadDirecciones} ${c.cantidadDirecciones === 1 ? 'dirección' : 'direcciones'}</span>
      </div>
      <p>${esc(c.telefono || 'Sin teléfono')}${c.email ? ` · ${esc(c.email)}` : ''}</p>
    </button>
  </li>`;


/* ---------- Ficha del cliente (perfil + direcciones) ---------- */

export async function abrirFicha(id, { alCambiar, alGuardar } = {}) {
  let cliente = { id: null, nombre: '', telefono: '', email: '', notas: '', direcciones: [] };

  if (id) {
    try {
      cliente = (await api(`/api/clientes/${id}`)).data;
    } catch (error) {
      mostrarToast(error.message, 'error');
      return;
    }
  }

  const { el, cerrar } = abrirModal('<div id="ficha"></div>', { alCerrar: () => alCambiar && alCambiar() });
  const ficha = el.querySelector('#ficha');

  const pintar = () => {
    ficha.innerHTML = `
      <h2 class="modal-titulo">${cliente.id ? 'Perfil del cliente' : 'Nuevo cliente'}</h2>

      <div class="alerta-error" id="cli-error" hidden></div>

      <div class="campo-grupo"><label for="cli-nombre">Nombre</label>
        <input class="campo" id="cli-nombre" maxlength="40" value="${esc(cliente.nombre)}"></div>
      <div class="campo-grupo"><label for="cli-telefono">Teléfono</label>
        <input class="campo" id="cli-telefono" maxlength="20" inputmode="tel" placeholder="+56 9 1234 5678" value="${esc(cliente.telefono)}"></div>
      <div class="campo-grupo"><label for="cli-email">Correo</label>
        <input class="campo" id="cli-email" maxlength="100" inputmode="email" value="${esc(cliente.email)}"></div>
      <div class="campo-grupo"><label for="cli-notas">Notas (alergias, preferencias)</label>
        <textarea class="campo campo-area" id="cli-notas" maxlength="300">${esc(cliente.notas)}</textarea></div>

      <button class="btn btn-primario btn-bloque" id="cli-guardar">${cliente.id ? 'Guardar cambios' : 'Crear cliente'}</button>

      ${cliente.id ? `
        <div class="seccion-titulo"><h2>Direcciones de despacho</h2></div>
        ${cliente.direcciones.length ? `<ul class="admin-lista">${cliente.direcciones.map(direccionHTML).join('')}</ul>` : '<p class="admin-vacio">Todavía no tiene direcciones.</p>'}
        ${cliente.direcciones.length < 5 ? `<button class="btn btn-secundario btn-bloque cli-nuevo" id="dir-nueva">${icono('mas', 18)} Agregar dirección</button>` : '<p class="admin-nota">Máximo 5 direcciones por cliente.</p>'}
        ${puede('eliminarClientes') ? '<button class="btn btn-peligro btn-bloque cli-nuevo" id="cli-eliminar">Eliminar cliente</button>' : ''}` : ''}

      <div class="modal-acciones"><button class="btn btn-secundario btn-bloque" data-cerrar-ficha>Cerrar</button></div>`;

    enlazar();
  };

  const direccionHTML = (d) => `
    <li class="admin-item">
      <div class="admin-item-cab">
        <strong>${esc(d.alias)}</strong>
        ${d.esPrincipal ? '<span class="admin-etiqueta etiqueta-buena">Principal</span>' : ''}
      </div>
      <p>${esc(resumen(d))}${d.ciudad ? `, ${esc(d.ciudad)}` : ''}</p>
      ${d.referencia ? `<p>Ref.: ${esc(d.referencia)}</p>` : ''}
      <div class="cli-acciones">
        <button class="btn btn-secundario" data-dir-editar="${d.id}">Editar</button>
        ${d.esPrincipal ? '' : `<button class="btn btn-secundario" data-dir-principal="${d.id}">Hacer principal</button>`}
        <button class="btn btn-peligro" data-dir-borrar="${d.id}">Eliminar</button>
      </div>
    </li>`;

  const recargar = async () => { cliente = (await api(`/api/clientes/${cliente.id}`)).data; pintar(); };

  const enlazar = () => {
    const error = ficha.querySelector('#cli-error');
    const mostrarError = (e) => { error.textContent = e.message; error.hidden = false; };

    ficha.querySelector('[data-cerrar-ficha]').addEventListener('click', cerrar);

    ficha.querySelector('#cli-guardar').addEventListener('click', async () => {
      error.hidden = true;

      const cuerpo = {
        nombre: ficha.querySelector('#cli-nombre').value,
        telefono: ficha.querySelector('#cli-telefono').value,
        email: ficha.querySelector('#cli-email').value,
        notas: ficha.querySelector('#cli-notas').value
      };

      try {
        const respuesta = cliente.id
          ? await api(`/api/clientes/${cliente.id}`, { metodo: 'PUT', cuerpo })
          : await api('/api/clientes', { metodo: 'POST', cuerpo });

        const eraNuevo = !cliente.id;
        cliente = respuesta.data;
        mostrarToast(eraNuevo ? 'Cliente registrado' : 'Cliente actualizado');

        if (eraNuevo && alGuardar) { cerrar(); alGuardar(cliente); return; }    // desde Pedidos: se elige de una vez
        pintar();                                                              // ahora se pueden agregar direcciones
      } catch (e) {
        mostrarError(e);
      }
    });

    if (!cliente.id) return;

    ficha.querySelector('#dir-nueva')?.addEventListener('click', () => abrirFormularioDireccion(cliente.id, null, recargar));

    ficha.querySelectorAll('[data-dir-editar]').forEach((b) => b.addEventListener('click', () => {
      abrirFormularioDireccion(cliente.id, cliente.direcciones.find((d) => d.id === Number(b.dataset.dirEditar)), recargar);
    }));

    ficha.querySelectorAll('[data-dir-principal]').forEach((b) => b.addEventListener('click', async () => {
      const d = cliente.direcciones.find((x) => x.id === Number(b.dataset.dirPrincipal));

      try {
        await api(`/api/clientes/${cliente.id}/direcciones/${d.id}`, { metodo: 'PUT', cuerpo: { ...d, esPrincipal: true } });
        await recargar();
      } catch (e) { mostrarError(e); }
    }));

    ficha.querySelectorAll('[data-dir-borrar]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/clientes/${cliente.id}/direcciones/${b.dataset.dirBorrar}`, { metodo: 'DELETE' });
        mostrarToast('Dirección eliminada');
        await recargar();
      } catch (e) { mostrarError(e); }
    }));

    ficha.querySelector('#cli-eliminar')?.addEventListener('click', async () => {
      try {
        await api(`/api/clientes/${cliente.id}`, { metodo: 'DELETE' });
        mostrarToast('Cliente eliminado');
        cerrar();
      } catch (e) { mostrarError(e); }
    });
  };

  pintar();
}

function abrirFormularioDireccion(idCliente, direccion, alGuardar) {
  const d = direccion || { alias: '', calle: '', numero: '', depto: '', comuna: '', ciudad: 'Santiago', referencia: '', esPrincipal: false };

  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">${direccion ? 'Editar dirección' : 'Nueva dirección'}</h2>
    <div class="alerta-error" id="dir-error" hidden></div>

    <div class="campo-grupo"><label for="dir-alias">Nombre (Casa, Trabajo…)</label><input class="campo" id="dir-alias" maxlength="30" value="${esc(d.alias)}"></div>
    <div class="campo-grupo"><label for="dir-calle">Calle</label><input class="campo" id="dir-calle" maxlength="80" value="${esc(d.calle)}"></div>
    <div class="dir-fila">
      <div class="campo-grupo"><label for="dir-numero">Número</label><input class="campo" id="dir-numero" maxlength="15" value="${esc(d.numero)}"></div>
      <div class="campo-grupo"><label for="dir-depto">Depto / casa</label><input class="campo" id="dir-depto" maxlength="20" value="${esc(d.depto)}"></div>
    </div>
    <div class="dir-fila">
      <div class="campo-grupo"><label for="dir-comuna">Comuna</label><input class="campo" id="dir-comuna" maxlength="40" value="${esc(d.comuna)}"></div>
      <div class="campo-grupo"><label for="dir-ciudad">Ciudad</label><input class="campo" id="dir-ciudad" maxlength="40" value="${esc(d.ciudad)}"></div>
    </div>
    <div class="campo-grupo"><label for="dir-referencia">Referencia (portón, timbre…)</label><input class="campo" id="dir-referencia" maxlength="150" value="${esc(d.referencia)}"></div>
    <label class="dir-principal"><input type="checkbox" id="dir-principal" ${d.esPrincipal ? 'checked' : ''}> Usar como dirección principal</label>

    <div class="modal-acciones">
      <button class="btn btn-primario btn-bloque" id="dir-guardar">Guardar dirección</button>
      <button class="btn btn-secundario btn-bloque" data-cerrar>Cancelar</button>
    </div>
  `);

  const error = el.querySelector('#dir-error');

  el.querySelector('#dir-guardar').addEventListener('click', async () => {
    error.hidden = true;

    const valor = (id) => el.querySelector(`#dir-${id}`).value;
    const cuerpo = {
      alias: valor('alias'), calle: valor('calle'), numero: valor('numero'), depto: valor('depto'), comuna: valor('comuna'),
      ciudad: valor('ciudad') || 'Santiago', referencia: valor('referencia'), esPrincipal: el.querySelector('#dir-principal').checked
    };

    try {
      if (direccion) await api(`/api/clientes/${idCliente}/direcciones/${direccion.id}`, { metodo: 'PUT', cuerpo });
      else await api(`/api/clientes/${idCliente}/direcciones`, { metodo: 'POST', cuerpo });

      cerrar();
      mostrarToast('Dirección guardada');
      await alGuardar();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    }
  });
}


/* ---------- Selector (lo usa Pedidos) ---------- */

export function abrirSelectorCliente(alElegir) {
  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">Elegir cliente</h2>
    <label class="campo-blanco">${icono('buscar', 16)}<input id="sel-buscar" placeholder="Buscar por nombre o teléfono" maxlength="40"></label>
    <div id="sel-lista" class="sel-lista"><p class="admin-vacio">Cargando…</p></div>
    <div class="modal-acciones">
      <button class="btn btn-secundario btn-bloque" id="sel-nuevo">${icono('mas', 18)} Cliente nuevo</button>
      <button class="btn btn-secundario btn-bloque" data-cerrar>Cancelar</button>
    </div>
  `);

  const lista = el.querySelector('#sel-lista');
  let espera = null;

  const elegir = async (id) => {
    try {
      const { data } = await api(`/api/clientes/${id}`);
      cerrar();
      alElegir(data);
    } catch (error) {
      mostrarToast(error.message, 'error');
    }
  };

  const cargar = async () => {
    const texto = el.querySelector('#sel-buscar').value.trim();

    try {
      const { data } = await api(`/api/clientes${texto ? `?buscar=${encodeURIComponent(texto)}` : ''}`);

      lista.innerHTML = data.length
        ? `<ul class="admin-lista">${data.map(clienteHTML).join('')}</ul>`
        : '<p class="admin-vacio">No hay clientes con ese nombre.</p>';

      lista.querySelectorAll('[data-cliente]').forEach((fila) => fila.addEventListener('click', () => elegir(Number(fila.dataset.cliente))));
    } catch (error) {
      lista.innerHTML = `<div class="alerta-error">${esc(error.message)}</div>`;
    }
  };

  el.querySelector('#sel-buscar').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargar, 250); });
  el.querySelector('#sel-nuevo').addEventListener('click', () => { cerrar(); abrirFicha(null, { alGuardar: (c) => elegir(c.id) }); });

  cargar();
}
