/* ==========================================================
   SECCIÓN: ADMINISTRACIÓN (solo administrador)
   Sprint 4:
     · Rendimiento  → #27 Monitoreo de rendimiento
     · Auditoría    → #29 Auditoría y logs de transacciones
     · Reportes     → #28 Feedback y reporte de fallos
     · Respaldos    → #30 Respaldo y restauración
   ========================================================== */

import { api } from '../../nucleo/api.js';
import { cargarDatos } from '../../nucleo/estado.js';
import { abrirModal, esc, formatoPrecio, icono, mostrarToast, numeroPedido } from '../../nucleo/utilidades.js';


const PESTANAS = [
  { id: 'ventas', etiqueta: 'Ventas' },                      // tarea 34
  { id: 'pagos', etiqueta: 'Pagos' },                        // tarea 32
  { id: 'rendimiento', etiqueta: 'Rendimiento' },
  { id: 'auditoria', etiqueta: 'Auditoría' },
  { id: 'reportes', etiqueta: 'Reportes' },
  { id: 'respaldos', etiqueta: 'Respaldos' }
];

const vista = { pestana: 'ventas', ventas: { dias: 7, desde: '', hasta: '' }, pagos: { estado: '' }, auditoria: { resultado: '', usuario: '' }, reportes: { estado: '' } };

let zona = null;


/* ---------- Formato ---------- */

const fechaHora = (valor) => (valor ? new Date(valor).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const kb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const duracion = (segundos) => (segundos >= 3600 ? `${Math.floor(segundos / 3600)} h ${Math.floor((segundos % 3600) / 60)} min` : `${Math.floor(segundos / 60)} min`);


/* ---------- Pantalla principal ---------- */

export function renderAdmin(raiz) {
  raiz.innerHTML = `
    <a class="enlace-atras" href="#/ajustes">${icono('atras', 18)} Ajustes</a>
    <h1 class="titulo">Administración</h1>
    <p class="subtitulo">Rendimiento, auditoría, reportes y respaldos.</p>

    <div class="admin-pestanas" role="tablist">
      ${PESTANAS.map((p) => `<button class="chip ${p.id === vista.pestana ? 'activo' : ''}" data-pestana="${p.id}" role="tab">${p.etiqueta}</button>`).join('')}
    </div>

    <div id="admin-zona"></div>
  `;

  zona = raiz.querySelector('#admin-zona');

  raiz.querySelector('.admin-pestanas').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-pestana]');
    if (!boton) return;

    vista.pestana = boton.dataset.pestana;
    raiz.querySelectorAll('[data-pestana]').forEach((b) => b.classList.toggle('activo', b === boton));
    cargarPestana();
  });

  cargarPestana();
}


async function cargarPestana() {
  const pestana = vista.pestana;
  zona.innerHTML = '<p class="admin-vacio">Cargando…</p>';

  try {
    const html = await PINTORES[pestana]();
    if (pestana !== vista.pestana) return;           // el usuario cambió de pestaña mientras cargaba

    zona.innerHTML = html;
    ENLAZADORES[pestana]();
  } catch (error) {
    if (pestana !== vista.pestana) return;
    zona.innerHTML = `<div class="alerta-error">${esc(error.message)}</div><button class="btn btn-secundario btn-bloque" id="admin-reintentar">Reintentar</button>`;
    zona.querySelector('#admin-reintentar').addEventListener('click', cargarPestana);
  }
}


/* ==========================================================
   #27 RENDIMIENTO
   ========================================================== */

async function pintarRendimiento() {
  const { data: m } = await api('/api/monitoreo');
  const bd = m.baseDeDatos;
  const s = m.solicitudes;

  const tarjeta = (titulo, valor, nota = '', clase = '') => `
    <div class="admin-dato ${clase}"><small>${titulo}</small><strong>${valor}</strong>${nota ? `<span>${nota}</span>` : ''}</div>`;

  return `
    <div class="admin-datos">
      ${tarjeta('Base de datos', bd.estado === 'ok' ? `${bd.latenciaMs} ms` : 'Sin conexión', bd.estado === 'ok' ? 'tiempo de respuesta' : '', bd.estado === 'ok' ? '' : 'malo')}
      ${tarjeta('Solicitudes', s.total, `${s.ultimoMinuto} en el último minuto`)}
      ${tarjeta('Errores del servidor', s.errores5xx, `${s.errores4xx} errores de uso (4xx)`, s.errores5xx ? 'malo' : '')}
      ${tarjeta('Lentas', s.lentas, `más de ${s.umbralLentoMs} ms`, s.lentas ? 'aviso' : '')}
      ${tarjeta('Memoria', `${m.servidor.memoriaMB.rss} MB`, `heap ${m.servidor.memoriaMB.heapUsado} MB`)}
      ${tarjeta('Servidor activo', duracion(m.servidor.activoSegundos), `Node ${esc(m.servidor.node)}`)}
    </div>

    <div class="seccion-titulo"><h2>Tiempos por ruta</h2></div>

    ${m.rutas.length ? `
      <div class="admin-tabla-caja">
        <table class="admin-tabla">
          <thead><tr><th>Ruta</th><th>Veces</th><th>Prom.</th><th>p95</th><th>Máx.</th><th>Err.</th></tr></thead>
          <tbody>
            ${m.rutas.map((r) => `
              <tr class="${r.p95Ms > s.umbralLentoMs ? 'fila-aviso' : ''}">
                <td>${esc(r.ruta)}</td><td>${r.solicitudes}</td><td>${r.promedioMs}</td><td>${r.p95Ms}</td><td>${r.maxMs}</td><td>${r.errores}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="admin-nota">Tiempos en milisegundos. p95: el 95 % de las solicitudes tardó menos que eso.</p>` : '<p class="admin-vacio">Todavía no hay mediciones.</p>'}

    <div class="admin-acciones">
      <button class="btn btn-secundario btn-bloque" id="admin-actualizar">Actualizar</button>
      <button class="btn btn-secundario btn-bloque" id="admin-reiniciar">Reiniciar mediciones</button>
    </div>
    <p class="admin-nota">Para generar carga de prueba: <code>npm run prueba-carga -- --usuario ${esc('tu_usuario')}</code> en la carpeta backend.</p>
  `;
}

function enlazarRendimiento() {
  zona.querySelector('#admin-actualizar').addEventListener('click', cargarPestana);

  zona.querySelector('#admin-reiniciar').addEventListener('click', async () => {
    try {
      await api('/api/monitoreo/reiniciar', { metodo: 'POST' });
      mostrarToast('Mediciones reiniciadas');
      cargarPestana();
    } catch (error) {
      mostrarToast(error.message, 'error');
    }
  });
}


/* ==========================================================
   #29 AUDITORÍA
   ========================================================== */

async function pintarAuditoria() {
  const f = vista.auditoria;
  const consulta = new URLSearchParams({ limite: '100' });

  if (f.resultado) consulta.set('resultado', f.resultado);
  if (f.usuario.trim()) consulta.set('usuario', f.usuario.trim());

  const { data } = await api(`/api/auditoria?${consulta}`);

  return `
    <div class="admin-filtros">
      <select class="campo" id="aud-resultado" aria-label="Resultado">
        <option value="">Todos</option>
        <option value="EXITO" ${f.resultado === 'EXITO' ? 'selected' : ''}>Solo correctos</option>
        <option value="FALLO" ${f.resultado === 'FALLO' ? 'selected' : ''}>Solo fallidos</option>
      </select>
      <input class="campo" id="aud-usuario" placeholder="Usuario" value="${esc(f.usuario)}" aria-label="Usuario">
      <button class="btn btn-primario" id="aud-buscar">Filtrar</button>
    </div>

    ${data.length ? `<ul class="admin-lista">
      ${data.map((a) => `
        <li class="admin-item">
          <div class="admin-item-cab">
            <strong>${esc(a.accion)}</strong>
            <span class="admin-etiqueta ${a.resultado === 'FALLO' ? 'etiqueta-mala' : 'etiqueta-buena'}">${a.resultado === 'FALLO' ? 'Fallo' : 'Correcto'}</span>
          </div>
          <p>${esc(a.usuario)}${a.rol ? ` · ${esc(a.rol)}` : ''} · ${esc(fechaHora(a.fecha))}</p>
          ${a.entidad ? `<p>${esc(a.entidad)}${a.idEntidad ? ` #${esc(a.idEntidad)}` : ''}</p>` : ''}
          ${a.detalle ? `<p class="admin-detalle">${esc(a.detalle)}</p>` : ''}
        </li>`).join('')}
    </ul>
    <p class="admin-nota">Se muestran los últimos ${data.length} registros.</p>` : '<p class="admin-vacio">No hay registros con esos filtros.</p>'}
  `;
}

function enlazarAuditoria() {
  const buscar = () => {
    vista.auditoria = {
      resultado: zona.querySelector('#aud-resultado').value,
      usuario: zona.querySelector('#aud-usuario').value
    };
    cargarPestana();
  };

  zona.querySelector('#aud-buscar').addEventListener('click', buscar);
  zona.querySelector('#aud-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscar(); });
}


/* ==========================================================
   #28 REPORTES (FEEDBACK Y FALLOS)
   ========================================================== */

const TEXTO_TIPO = { FALLO: 'Fallo', SUGERENCIA: 'Sugerencia', COMENTARIO: 'Comentario' };
const TEXTO_ESTADO = { ABIERTO: 'Abierto', EN_REVISION: 'En revisión', RESUELTO: 'Resuelto' };

async function pintarReportes() {
  const filtro = vista.reportes.estado;
  const { data } = await api(`/api/feedback?limite=100${filtro ? `&estado=${filtro}` : ''}`);

  const chip = (valor, texto) => `<button class="chip ${filtro === valor ? 'activo' : ''}" data-estado="${valor}">${texto}</button>`;

  return `
    <div class="admin-pestanas">
      ${chip('', 'Todos')}${chip('ABIERTO', 'Abiertos')}${chip('EN_REVISION', 'En revisión')}${chip('RESUELTO', 'Resueltos')}
    </div>

    ${data.length ? `<ul class="admin-lista">
      ${data.map((r) => `
        <li class="admin-item">
          <div class="admin-item-cab">
            <strong>${esc(r.titulo)}</strong>
            <span class="admin-etiqueta ${r.tipo === 'FALLO' ? 'etiqueta-mala' : 'etiqueta-neutra'}">${TEXTO_TIPO[r.tipo] || esc(r.tipo)}${r.gravedad ? ` · ${esc(r.gravedad.toLowerCase())}` : ''}</span>
          </div>
          <p>${esc(r.usuario)} · ${esc(fechaHora(r.fecha))}${r.pantalla ? ` · ${esc(r.pantalla)}` : ''}${r.origen === 'AUTOMATICO' ? ' · automático' : ''}</p>
          <p class="admin-detalle">${esc(r.descripcion)}</p>
          <select class="campo admin-estado" data-id="${r.id}" aria-label="Estado del reporte">
            ${Object.entries(TEXTO_ESTADO).map(([valor, texto]) => `<option value="${valor}" ${r.estado === valor ? 'selected' : ''}>${texto}</option>`).join('')}
          </select>
        </li>`).join('')}
    </ul>` : '<p class="admin-vacio">No hay reportes.</p>'}
  `;
}

function enlazarReportes() {
  zona.querySelectorAll('[data-estado]').forEach((boton) => {
    boton.addEventListener('click', () => {
      vista.reportes.estado = boton.dataset.estado;
      cargarPestana();
    });
  });

  zona.querySelectorAll('.admin-estado').forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api(`/api/feedback/${select.dataset.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: select.value } });
        mostrarToast('Reporte actualizado');
      } catch (error) {
        mostrarToast(error.message, 'error');
        cargarPestana();
      }
    });
  });
}


/* ==========================================================
   #30 RESPALDOS
   ========================================================== */

async function pintarRespaldos() {
  const { data } = await api('/api/respaldos');

  return `
    <button class="btn btn-primario btn-bloque" id="resp-crear">${icono('mas', 18)} Crear respaldo ahora</button>
    <p class="admin-nota">El servidor también respalda solo cada cierto tiempo. Se guardan los últimos respaldos en la carpeta <code>backend/respaldos</code>.</p>

    <div class="seccion-titulo"><h2>Respaldos guardados</h2></div>

    ${data.length ? `<ul class="admin-lista">
      ${data.map((r) => `
        <li class="admin-item">
          <div class="admin-item-cab">
            <strong>${esc(fechaHora(r.creado))}</strong>
            <span class="admin-etiqueta ${r.tipo === 'seguridad' ? 'etiqueta-aviso' : 'etiqueta-neutra'}">${r.tipo === 'seguridad' ? 'Seguridad previa' : 'Respaldo'}</span>
          </div>
          <p>${esc(r.archivo)} · ${kb(r.tamanoBytes)}</p>
          <button class="btn btn-peligro admin-restaurar" data-archivo="${esc(r.archivo)}">Restaurar este respaldo</button>
        </li>`).join('')}
    </ul>` : '<p class="admin-vacio">Todavía no hay respaldos.</p>'}
  `;
}

function enlazarRespaldos() {
  const boton = zona.querySelector('#resp-crear');

  boton.addEventListener('click', async () => {
    boton.disabled = true;

    try {
      const { data } = await api('/api/respaldos', { metodo: 'POST' });
      const filas = Object.values(data.tablas).reduce((a, b) => a + b, 0);
      mostrarToast(`Respaldo creado (${filas} registros)`);
    } catch (error) {
      mostrarToast(error.message, 'error');
    }

    cargarPestana();
  });

  zona.querySelectorAll('.admin-restaurar').forEach((b) => {
    b.addEventListener('click', () => confirmarRestauracion(b.dataset.archivo));
  });
}

function confirmarRestauracion(archivo) {
  const { el, cerrar } = abrirModal(`
    <h2 class="modal-titulo">Restaurar respaldo</h2>

    <div class="alerta-error">
      Esto reemplaza los productos, pedidos, clientes y usuarios actuales por los de <strong>${esc(archivo)}</strong>.
      Antes se guarda un respaldo de seguridad del estado de ahora.
    </div>

    <div class="campo-grupo">
      <label for="resp-confirmar">Escribe RESTAURAR para confirmar</label>
      <input class="campo" id="resp-confirmar" autocomplete="off" placeholder="RESTAURAR">
    </div>

    <div class="modal-acciones">
      <button class="btn btn-peligro btn-bloque" id="resp-ejecutar" disabled>Restaurar ahora</button>
      <button class="btn btn-secundario btn-bloque" data-cerrar>Cancelar</button>
    </div>
  `);

  const campo = el.querySelector('#resp-confirmar');
  const ejecutar = el.querySelector('#resp-ejecutar');

  campo.addEventListener('input', () => { ejecutar.disabled = campo.value.trim() !== 'RESTAURAR'; });

  ejecutar.addEventListener('click', async () => {
    ejecutar.disabled = true;
    ejecutar.textContent = 'Restaurando…';

    try {
      const { data } = await api('/api/respaldos/restaurar', { metodo: 'POST', cuerpo: { archivo, confirmar: 'RESTAURAR' } });
      cerrar();
      mostrarToast('Respaldo restaurado. Actualizando datos…');
      data.advertencias.forEach((aviso) => mostrarToast(aviso, 'error'));

      // Los datos cambiaron: se vuelven a pedir al servidor desde cero
      await cargarDatos();
      cargarPestana();
    } catch (error) {
      cerrar();
      mostrarToast(error.message, 'error');
    }
  });
}


/* ==========================================================
   #34 VENTAS
   ========================================================== */

const aFecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function pintarVentas() {
  const f = vista.ventas;
  const hoy = new Date();

  // Un atajo (Hoy, 7 días, 30 días) o fechas elegidas a mano
  const consulta = new URLSearchParams();
  if (f.dias) {
    consulta.set('desde', aFecha(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (f.dias - 1))));
    consulta.set('hasta', aFecha(hoy));
  } else {
    if (f.desde) consulta.set('desde', f.desde);
    if (f.hasta) consulta.set('hasta', f.hasta);
  }

  const { data: v } = await api(`/api/analitica/ventas?${consulta}`);

  const chip = (dias, texto) => `<button class="chip ${f.dias === dias ? 'activo' : ''}" data-dias="${dias}">${texto}</button>`;
  const tarjeta = (titulo, valor, nota = '') => `<div class="admin-dato"><small>${titulo}</small><strong>${valor}</strong>${nota ? `<span>${nota}</span>` : ''}</div>`;

  // Barras proporcionales al valor más alto (el mínimo visible evita que un día con poco se vea vacío)
  const maxDia = Math.max(1, ...v.porDia.map((d) => d.total));
  const maxHora = Math.max(1, ...v.porHora.map((h) => h.pedidos));
  const ranking = (filas, texto, valor, maximo) => `<div class="ranking">${filas.map((x) => `
    <div class="ranking-fila"><small><strong>${esc(texto(x))}</strong><span>${valor(x)}</span></small>
      <div class="ranking-barra"><span style="width:${Math.max(4, Math.round((x.monto ?? x.total) / maximo * 100))}%"></span></div></div>`).join('')}</div>`;

  const sinVentas = v.resumen.pedidos === 0;

  return `
    <div class="admin-pestanas">${chip(1, 'Hoy')}${chip(7, '7 días')}${chip(30, '30 días')}</div>
    <div class="ventas-rango">
      <input class="campo" type="date" id="ven-desde" value="${f.dias ? '' : esc(v.rango.desde)}" aria-label="Desde">
      <input class="campo" type="date" id="ven-hasta" value="${f.dias ? '' : esc(v.rango.hasta)}" aria-label="Hasta">
      <button class="btn btn-secundario" id="ven-ver">Ver</button>
    </div>
    <p class="admin-nota">Del ${esc(v.rango.desde)} al ${esc(v.rango.hasta)} (${v.rango.dias} ${v.rango.dias === 1 ? 'día' : 'días'}). Cuenta los pedidos no cancelados.</p>

    <div class="admin-datos" style="margin-top:12px">
      ${tarjeta('Ventas', formatoPrecio(v.resumen.total))}
      ${tarjeta('Pedidos', v.resumen.pedidos)}
      ${tarjeta('Ticket promedio', formatoPrecio(v.resumen.ticketPromedio))}
      ${v.cobros ? tarjeta('Sin cobrar', formatoPrecio(v.cobros.sinCobrar.total), `${v.cobros.sinCobrar.pedidos} pedido(s)`) : tarjeta('Cobros', '—', 'faltan las tablas de pagos')}
    </div>

    ${sinVentas ? '<p class="admin-vacio">No hay ventas en este periodo.</p>' : `
      <div class="seccion-titulo"><h2>Ventas por día</h2></div>
      <div class="barras-dia">${v.porDia.map((d) => `<div class="${d.total ? '' : 'vacio'}" title="${esc(d.dia)}: ${esc(formatoPrecio(d.total))}" style="height:${Math.max(3, Math.round(d.total / maxDia * 100))}%"></div>`).join('')}</div>
      <div class="barras-eje"><span>${esc(v.porDia[0].dia.slice(5))}</span><span>${esc(v.porDia.at(-1).dia.slice(5))}</span></div>

      <div class="seccion-titulo"><h2>Productos más vendidos</h2></div>
      ${ranking(v.topProductos, (p) => p.nombre, (p) => `${p.unidades} uds · ${formatoPrecio(p.monto)}`, Math.max(1, v.topProductos[0].monto))}

      <div class="seccion-titulo"><h2>Por categoría</h2></div>
      ${ranking(v.porCategoria, (c) => c.categoria, (c) => formatoPrecio(c.monto), Math.max(1, v.porCategoria[0].monto))}

      <div class="seccion-titulo"><h2>Tipo de entrega</h2></div>
      ${ranking(v.porEntrega, (e) => e.tipo, (e) => `${e.pedidos} pedido(s) · ${formatoPrecio(e.total)}`, Math.max(1, v.porEntrega[0].total))}

      <div class="seccion-titulo"><h2>Horas con más pedidos</h2></div>
      <div class="barras-dia">${v.porHora.map((h) => `<div class="${h.pedidos ? '' : 'vacio'}" title="${h.hora}:00 · ${h.pedidos} pedido(s)" style="height:${Math.max(3, Math.round(h.pedidos / maxHora * 100))}%"></div>`).join('')}</div>
      <div class="barras-eje"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>

      ${v.cobros && v.cobros.porMetodo.length ? `
        <div class="seccion-titulo"><h2>Cobros por método</h2></div>
        ${ranking(v.cobros.porMetodo, (m) => (m.metodo === 'EFECTIVO' ? 'Efectivo' : 'Tarjeta (Webpay)'), (m) => `${m.pagos} pago(s) · ${formatoPrecio(m.total)}`, Math.max(1, v.cobros.porMetodo[0].total))}` : ''}`}
  `;
}

function enlazarVentas() {
  zona.querySelectorAll('[data-dias]').forEach((b) => b.addEventListener('click', () => {
    vista.ventas = { dias: Number(b.dataset.dias), desde: '', hasta: '' };
    cargarPestana();
  }));

  zona.querySelector('#ven-ver').addEventListener('click', () => {
    vista.ventas = { dias: 0, desde: zona.querySelector('#ven-desde').value, hasta: zona.querySelector('#ven-hasta').value };
    cargarPestana();
  });
}


/* ==========================================================
   #32 PAGOS
   ========================================================== */

const TEXTO_PAGO = { AUTORIZADO: 'Pagado', ANULADO: 'Anulado', RECHAZADO: 'Rechazado', CREADO: 'Iniciado', CONFIRMANDO: 'Confirmando', EXPIRADO: 'Vencido', ABANDONADO: 'Abandonado' };
const CLASE_PAGO = { AUTORIZADO: 'etiqueta-buena', ANULADO: 'etiqueta-aviso', RECHAZADO: 'etiqueta-mala', CREADO: 'etiqueta-neutra', CONFIRMANDO: 'etiqueta-aviso', EXPIRADO: 'etiqueta-neutra', ABANDONADO: 'etiqueta-neutra' };

async function pintarPagos() {
  const filtro = vista.pagos.estado;
  const { data } = await api(`/api/pagos/historial?limite=100${filtro ? `&estado=${filtro}` : ''}`);

  const chip = (valor, texto) => `<button class="chip ${filtro === valor ? 'activo' : ''}" data-estado-pago="${valor}">${texto}</button>`;

  return `
    <div class="admin-pestanas">${chip('', 'Todos')}${chip('AUTORIZADO', 'Pagados')}${chip('RECHAZADO', 'Rechazados')}${chip('ANULADO', 'Anulados')}</div>

    ${data.length ? `<ul class="admin-lista">${data.map((p) => `
      <li class="admin-item">
        <div class="admin-item-cab">
          <strong>${esc(numeroPedido(p.idPedido))} · ${esc(formatoPrecio(p.monto))}</strong>
          <span class="admin-etiqueta ${CLASE_PAGO[p.estado] || 'etiqueta-neutra'}">${esc(TEXTO_PAGO[p.estado] || p.estado)}</span>
        </div>
        <p>${p.metodo === 'EFECTIVO' ? 'Efectivo' : `Tarjeta${p.ultimos4 ? ` ····${esc(p.ultimos4)}` : ''}`} · ${esc(p.usuario || '—')} · ${esc(fechaHora(p.fecha))}</p>
        ${p.detalle ? `<p class="admin-detalle">${esc(p.detalle)}</p>` : ''}
        ${p.estado === 'AUTORIZADO' ? `<button class="btn btn-peligro admin-restaurar" data-anular="${p.id}">Anular y reembolsar</button>` : ''}
      </li>`).join('')}</ul>` : '<p class="admin-vacio">No hay pagos.</p>'}
  `;
}

function enlazarPagos() {
  zona.querySelectorAll('[data-estado-pago]').forEach((b) => b.addEventListener('click', () => {
    vista.pagos.estado = b.dataset.estadoPago;
    cargarPestana();
  }));

  zona.querySelectorAll('[data-anular]').forEach((b) => b.addEventListener('click', () => {
    const { el, cerrar } = abrirModal(`
      <h2 class="modal-titulo">Anular pago</h2>
      <div class="alerta-error">Se devolverá el dinero al cliente (si pagó con tarjeta, la pasarela hace el reembolso). Esto no se puede deshacer.</div>
      <div class="modal-acciones">
        <button class="btn btn-peligro btn-bloque" id="anular-ok">Sí, anular el pago</button>
        <button class="btn btn-secundario btn-bloque" data-cerrar>No, volver</button>
      </div>`);

    el.querySelector('#anular-ok').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;

      try {
        await api(`/api/pagos/${b.dataset.anular}/anular`, { metodo: 'POST' });
        mostrarToast('Pago anulado');
      } catch (error) {
        mostrarToast(error.message, 'error');
      }

      cerrar();
      cargarPestana();
    });
  }));
}


const PINTORES = { ventas: pintarVentas, pagos: pintarPagos, rendimiento: pintarRendimiento, auditoria: pintarAuditoria, reportes: pintarReportes, respaldos: pintarRespaldos };
const ENLAZADORES = { ventas: enlazarVentas, pagos: enlazarPagos, rendimiento: enlazarRendimiento, auditoria: enlazarAuditoria, reportes: enlazarReportes, respaldos: enlazarRespaldos };
