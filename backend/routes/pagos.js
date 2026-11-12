import { Router } from 'express';
import express from 'express';
import { autenticar, exigirRol } from '../middleware/auth.js';
import { auditar } from '../middleware/auditoria.js';
import { ErrorApp } from '../services/errores.js';
import { logger } from '../services/logger.js';
import { validateEfectivo, validateTarjeta, validatePedidosPago, validateHistorialPagos } from '../validators/pagoValidator.js';
import {
  pagarEnEfectivo, iniciarPagoTarjeta, procesarRetorno, anularPago, pagosDePedidos, historialPagos
} from '../services/pagoService.js';


const esc = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function rutasPagos(db, proveedor, config) {
  const router = Router();

  const cobra = exigirRol('administrador', 'cajero');

  /* ---------- Cobrar ---------- */

  router.post('/efectivo', autenticar,
    auditar(db, {
      accion: 'PAGO_EFECTIVO',
      entidad: 'PEDIDO',
      idEntidad: (req) => req.body && req.body.idPedido,
      detalle: (req, cuerpo) => `$${cuerpo.data.monto} en efectivo`
    }),
    cobra, validateEfectivo,
    async (req, res) => {
      res.status(201).json({ status: 'success', message: 'Pago en efectivo registrado.', data: await pagarEnEfectivo(db, req.usuario, req.body) });
    });

  // Crea el pago y entrega la dirección de Webpay a la que el navegador debe enviar al cliente
  router.post('/tarjeta', autenticar,
    auditar(db, {
      accion: 'PAGO_TARJETA_INICIAR',
      entidad: 'PEDIDO',
      idEntidad: (req) => req.body && req.body.idPedido,
      detalle: (req, cuerpo) => `$${cuerpo.data.monto} con tarjeta (${cuerpo.data.proveedor})`
    }),
    cobra, validateTarjeta,
    async (req, res) => {
      const pago = await iniciarPagoTarjeta(db, proveedor, config, req.usuario, req.body.idPedido);
      res.status(201).json({ status: 'success', data: pago });
    });


  /* ---------- Vuelta desde Webpay (pública: no lleva sesión, se valida el token con Transbank) ---------- */

  const retorno = async (req, res) => {
    const params = { ...req.query, ...(req.body || {}) };
    let resultado = { resultado: 'error' };

    try {
      resultado = await procesarRetorno(db, proveedor, config, params);
    } catch (error) {
      logger.error('retorno_pago_fallido', { motivo: error.message });
    }

    // De vuelta a la app, con el resultado en la dirección (no contiene datos sensibles)
    const consulta = new URLSearchParams({ pago: resultado.resultado });
    if (resultado.idPedido) consulta.set('pedido', String(resultado.idPedido));

    res.redirect(303, `${config.urlFrontend}/#/pedidos?${consulta}`);
  };

  router.get('/retorno', retorno);
  router.post('/retorno', express.urlencoded({ extended: false, limit: '10kb' }), retorno);


  /* ---------- Anular y consultar ---------- */

  router.post('/:id/anular', autenticar,
    auditar(db, { accion: 'PAGO_ANULAR', entidad: 'PAGO', idEntidad: (req) => req.params.id, detalle: (req, cuerpo) => `Pedido ${cuerpo.data.idPedido} · $${cuerpo.data.monto}` }),
    exigirRol('administrador'),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new ErrorApp(400, 'El id del pago no es válido.');

      res.json({ status: 'success', message: 'Pago anulado.', data: await anularPago(db, proveedor, req.usuario, id) });
    });

  // Estado de pago de varios pedidos: GET /api/pagos?pedidos=1,2,3
  router.get('/', autenticar, cobra, validatePedidosPago, async (req, res) => {
    const ids = req.consulta.pedidos.split(',').map(Number);
    res.json({ status: 'success', data: await pagosDePedidos(db, ids) });
  });

  router.get('/historial', autenticar, exigirRol('administrador'), validateHistorialPagos, async (req, res) => {
    res.json({ status: 'success', data: await historialPagos(db, req.consulta) });
  });


  /* ---------- Pantalla de pago simulada (solo con PAGOS_PROVEEDOR=simulado, nunca en producción) ---------- */

  if (proveedor.nombre === 'simulado' && !config.produccion && config.ambiente !== 'produccion') {
    const pagina = (token) => {
      const datos = proveedor.datosDe(token);
      if (!datos) return '<p>La transacción simulada no existe o ya venció.</p>';

      const boton = (decision, texto, clase) => `
        <form method="post" action="${esc(config.urlPublicaApi)}/api/pagos/simulador/resolver">
          <input type="hidden" name="token_ws" value="${esc(token)}"><input type="hidden" name="decision" value="${decision}">
          <button class="${clase}">${texto}</button>
        </form>`;

      return `
        <h1>Pago simulado</h1>
        <p class="aviso">Esto NO es Webpay: es una pantalla de pruebas para desarrollo.</p>
        <p>Orden <strong>${esc(datos.buyOrder)}</strong></p>
        <p class="monto">$${esc(String(datos.monto).replace(/\B(?=(\d{3})+(?!\d))/g, '.'))}</p>
        ${boton('aprobar', 'Aprobar pago', 'ok')}${boton('rechazar', 'Rechazar pago', 'no')}${boton('cancelar', 'Cancelar', 'cancelar')}`;
    };

    const html = (cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Pago simulado</title><style>
        body{font-family:system-ui,sans-serif;max-width:360px;margin:40px auto;padding:0 20px;color:#1b1b1b}
        .aviso{background:#fff4cc;padding:10px 12px;border-radius:10px;font-size:13px}
        .monto{font-size:34px;font-weight:800;margin:6px 0 18px} form{margin-top:10px}
        button{width:100%;height:48px;border:0;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer}
        .ok{background:#2e9d57;color:#fff}.no{background:#d64545;color:#fff}.cancelar{background:#eee}
      </style></head><body>${cuerpo}</body></html>`;

    const leerToken = (req) => String((req.body && req.body.token_ws) || req.query.token_ws || '').replace(/[^A-Za-z0-9]/g, '');

    router.get('/simulador', (req, res) => res.type('html').send(html(pagina(leerToken(req)))));
    router.post('/simulador', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => res.type('html').send(html(pagina(leerToken(req)))));

    router.post('/simulador/resolver', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
      const token = leerToken(req);
      const decision = req.body && req.body.decision;
      const datos = proveedor.datosDe(token);

      if (!datos || !['aprobar', 'rechazar', 'cancelar'].includes(decision)) return res.status(400).type('html').send(html('<p>Solicitud no válida.</p>'));

      // Igual que Webpay: al cancelar vuelve con TBK_TOKEN; al pagar o fallar, con token_ws
      if (decision === 'cancelar') {
        const consulta = new URLSearchParams({ TBK_TOKEN: token, TBK_ORDEN_COMPRA: datos.buyOrder, TBK_ID_SESION: 'simulado' });
        return res.redirect(303, `${config.urlPublicaApi}/api/pagos/retorno?${consulta}`);
      }

      proveedor.decidir(token, decision);
      res.redirect(303, `${config.urlPublicaApi}/api/pagos/retorno?token_ws=${encodeURIComponent(token)}`);
    });
  }

  return router;
}
