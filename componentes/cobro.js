/* ==========================================================
   COBRO DE UN PEDIDO (tarea #32)
   · Efectivo: se registra al instante (con cálculo de vuelto).
   · Tarjeta: se abre Webpay en otra pestaña; el cliente paga ahí
     (los datos de la tarjeta nunca pasan por esta app) y vuelve solo.
   El monto siempre sale del pedido en la base de datos.
   ========================================================== */

import { api } from '../nucleo/api.js';
import { estado, recargarPedidos } from '../nucleo/estado.js';
import { abrirModal, esc, formatoPrecio, icono, mostrarToast, numeroPedido } from '../nucleo/utilidades.js';


const NOMBRE_VENTANA = 'pagoWebpay';

// Webpay exige enviar el token por POST: se arma un formulario invisible y se envía a la pestaña de pago
function enviarAWebpay(url, token, ventana) {
  const formulario = document.createElement('form');

  formulario.method = 'POST';
  formulario.action = url;
  formulario.target = ventana ? NOMBRE_VENTANA : '_self';     // si el navegador bloqueó la pestaña, se usa esta misma

  const campo = document.createElement('input');
  campo.type = 'hidden';
  campo.name = 'token_ws';
  campo.value = token;
  formulario.appendChild(campo);

  document.body.appendChild(formulario);
  formulario.submit();
  formulario.remove();
}

export function abrirCobro(pedido, alTerminar) {
  const total = pedido.total;

  const { el, cerrar } = abrirModal(`
    <div id="cobro">
      <h2 class="modal-titulo">Cobrar pedido ${numeroPedido(pedido.numero)}</h2>
      <p class="admin-nota">${esc(pedido.destino)} · ${esc(pedido.cliente)}</p>
      <p class="cobro-total">${formatoPrecio(total)}</p>

      <div class="alerta-error" id="cobro-error" hidden></div>

      <div class="cobro-opciones">
        <section class="cobro-opcion">
          <h3>Efectivo</h3>
          <div class="campo-grupo">
            <label for="cobro-recibido">Monto recibido (opcional)</label>
            <input class="campo" id="cobro-recibido" inputmode="numeric" placeholder="Para calcular el vuelto">
          </div>
          <p class="cobro-vuelto" id="cobro-vuelto"></p>
          <button class="btn btn-primario btn-bloque" id="cobro-efectivo">Registrar pago en efectivo</button>
        </section>

        <section class="cobro-opcion">
          <h3>Tarjeta (Webpay)</h3>
          <button class="btn btn-secundario btn-bloque" id="cobro-tarjeta">${icono('tarjeta', 18)} Cobrar con tarjeta</button>
        </section>
      </div>

      <div class="modal-acciones"><button class="btn btn-secundario btn-bloque" data-cerrar>Cancelar</button></div>
    </div>
  `);

  const error = el.querySelector('#cobro-error');
  const recibido = el.querySelector('#cobro-recibido');
  const vuelto = el.querySelector('#cobro-vuelto');

  const leerRecibido = () => {
    const numero = Number(recibido.value.replace(/\D/g, ''));
    return recibido.value.trim() ? numero : undefined;
  };

  recibido.addEventListener('input', () => {
    const n = leerRecibido();
    vuelto.textContent = n === undefined ? '' : n >= total ? `Vuelto: ${formatoPrecio(n - total)}` : `Faltan ${formatoPrecio(total - n)}`;
  });

  const fallar = (e) => { error.textContent = e.message; error.hidden = false; };

  /* ----- Efectivo ----- */

  el.querySelector('#cobro-efectivo').addEventListener('click', async (e) => {
    error.hidden = true;
    e.currentTarget.disabled = true;

    try {
      const { data } = await api('/api/pagos/efectivo', { metodo: 'POST', cuerpo: { idPedido: pedido.numero, ...(leerRecibido() !== undefined ? { recibido: leerRecibido() } : {}) } });

      cerrar();
      mostrarToast(data.vuelto ? `Pago registrado. Vuelto: ${formatoPrecio(data.vuelto)}` : 'Pago en efectivo registrado');
      await recargarPedidos();
      alTerminar();
    } catch (err) {
      e.currentTarget.disabled = false;
      fallar(err);
    }
  });

  /* ----- Tarjeta ----- */

  el.querySelector('#cobro-tarjeta').addEventListener('click', async (e) => {
    error.hidden = true;
    e.currentTarget.disabled = true;

    // La pestaña se abre YA (con el clic del usuario) para que el navegador no la bloquee; luego se le envía a Webpay
    const ventana = window.open('about:blank', NOMBRE_VENTANA);

    try {
      const { data } = await api('/api/pagos/tarjeta', { metodo: 'POST', cuerpo: { idPedido: pedido.numero } });
      enviarAWebpay(data.url, data.token, ventana);

      el.querySelector('#cobro').innerHTML = `
        <h2 class="modal-titulo">Esperando el pago…</h2>
        <p class="cobro-espera">El cliente está pagando en la pestaña de Webpay.<br>Cuando termine, el resultado aparece aquí solo.</p>
        <div class="modal-acciones">
          <button class="btn btn-primario btn-bloque" id="cobro-actualizar">Ya pagó: revisar</button>
          <button class="btn btn-secundario btn-bloque" data-cerrar-cobro>Cerrar</button>
        </div>`;

      el.querySelector('[data-cerrar-cobro]').addEventListener('click', () => { cerrar(); alTerminar(); });

      el.querySelector('#cobro-actualizar').addEventListener('click', async () => {
        await recargarPedidos();

        if (estado.pagos[pedido.numero] && estado.pagos[pedido.numero].estado === 'AUTORIZADO') {
          cerrar();
          mostrarToast('Pago aprobado');
        } else {
          mostrarToast('Todavía no se confirma el pago', 'error');
        }

        alTerminar();
      });
    } catch (err) {
      if (ventana) ventana.close();
      e.currentTarget.disabled = false;
      fallar(err);
    }
  });
}
