/* ==========================================================
   PROVEEDOR: WEBPAY PLUS (Transbank, API REST)
   Tarea #32 Integración de pasarela de pagos

   Flujo:  crear → (el cliente paga en el sitio de Transbank) →
           confirmar con el token que vuelve → (opcional) reembolsar.
   Los datos de la tarjeta NUNCA pasan por este servidor.

   Ambientes:  integracion → https://webpay3gint.transbank.cl (pruebas, sin dinero)
               produccion  → https://webpay3g.transbank.cl     (dinero real)
   ========================================================== */

import { ErrorApp } from '../errores.js';
import { logger } from '../logger.js';


const URLS = {
  integracion: 'https://webpay3gint.transbank.cl',
  produccion: 'https://webpay3g.transbank.cl'
};

const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions';
const TIEMPO_MAX_MS = 15000;


export function crearProveedorTransbank({ ambiente, codigoComercio, llaveSecreta }, fetchFn = fetch) {
  const base = URLS[ambiente];
  if (!base) throw new Error(`Ambiente de Webpay no válido: ${ambiente}`);

  async function peticion(metodo, ruta, cuerpo) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_MAX_MS);

    try {
      const respuesta = await fetchFn(`${base}${RUTA}${ruta}`, {
        method: metodo,
        headers: { 'Tbk-Api-Key-Id': codigoComercio, 'Tbk-Api-Key-Secret': llaveSecreta, 'Content-Type': 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: control.signal
      });

      const texto = await respuesta.text();
      let datos = {};
      try { datos = texto ? JSON.parse(texto) : {}; } catch { /* respuesta que no es JSON */ }

      if (!respuesta.ok) {
        // Nada de esto llega al navegador: solo al log del servidor
        logger.error('webpay_error', { metodo, ruta: ruta || '/', estado: respuesta.status, mensaje: datos.error_message });
        throw new ErrorApp(502, 'La pasarela de pagos rechazó la operación. Inténtalo de nuevo o cobra en efectivo.');
      }

      return datos;
    } catch (error) {
      if (error instanceof ErrorApp) throw error;

      logger.error('webpay_sin_respuesta', { metodo, motivo: error.name === 'AbortError' ? 'tiempo de espera agotado' : error.message });
      throw new ErrorApp(502, 'No se pudo conectar con la pasarela de pagos. Inténtalo de nuevo o cobra en efectivo.');
    } finally {
      clearTimeout(temporizador);
    }
  }

  // Webpay devuelve "AUTHORIZED" con código 0 solo cuando el pago realmente se aprobó
  const aResultado = (d) => ({
    aprobado: d.status === 'AUTHORIZED' && d.response_code === 0,
    estadoPasarela: d.status,
    codigoRespuesta: d.response_code,
    codigoAutorizacion: d.authorization_code || null,
    tipoTarjeta: d.payment_type_code || null,
    ultimos4: d.card_detail && d.card_detail.card_number ? String(d.card_detail.card_number).slice(-4) : null,
    cuotas: d.installments_number ?? null,
    monto: d.amount,
    buyOrder: d.buy_order
  });

  return {
    nombre: 'transbank',

    async crear({ buyOrder, sessionId, monto, urlRetorno }) {
      const d = await peticion('POST', '', { buy_order: buyOrder, session_id: sessionId, amount: monto, return_url: urlRetorno });

      if (!d.token || !d.url) throw new ErrorApp(502, 'La pasarela de pagos respondió algo inesperado.');
      return { token: d.token, url: d.url };
    },

    async confirmar(token) {
      return aResultado(await peticion('PUT', `/${encodeURIComponent(token)}`));
    },

    // Consulta el estado real en Transbank (para recuperar un pago cuya respuesta se perdió)
    async estado(token) {
      return aResultado(await peticion('GET', `/${encodeURIComponent(token)}`));
    },

    // Webpay decide solo si es una reversa o una anulación según el tiempo transcurrido
    async reembolsar(token, monto) {
      const d = await peticion('POST', `/${encodeURIComponent(token)}/refunds`, { amount: monto });
      const ok = d.type === 'REVERSED' || d.type === 'NULLIFIED';

      return { ok, tipo: d.type, codigoRespuesta: d.response_code };
    }
  };
}
