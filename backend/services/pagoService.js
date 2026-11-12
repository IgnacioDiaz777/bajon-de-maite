/* ==========================================================
   PAGOS DE PEDIDOS
   Tarea #32 Integración de pasarela de pagos (producción)

   · Efectivo: lo registra el cajero.
   · Tarjeta: Webpay Plus. El cliente paga en el sitio de Transbank
     (los datos de la tarjeta nunca pasan por aquí) y vuelve a
     /api/pagos/retorno con un token que se confirma con Transbank.

   Medidas pensadas para producción:
   · El monto SIEMPRE sale del pedido en la base de datos, nunca del navegador.
   · Un pago solo se confirma una vez (UPDATE condicionado por estado).
   · Si el monto que confirma la pasarela no coincide, se reembolsa y se rechaza.
   · Un pedido no puede quedar pagado dos veces (índice único en Oracle).
   · Si se pierde la respuesta de la pasarela, un proceso de conciliación consulta
     el estado real en Transbank.
   · No se guardan datos de tarjeta: solo los últimos 4 dígitos que informa Transbank.
   ========================================================== */

import { randomBytes } from 'node:crypto';
import { ErrorApp, primerValor } from './errores.js';
import { logger } from './logger.js';
import { registrarAuditoria } from './auditService.js';
import { alertarPago } from './alertasService.js';


const FORMATO_TOKEN = /^[A-Za-z0-9]{10,100}$/;

const aPago = (r) => ({
  id: r.ID_PAGO,
  idPedido: r.ID_PEDIDO,
  metodo: r.METODO,
  proveedor: r.PROVEEDOR,
  monto: r.MONTO,
  estado: r.ESTADO,
  codigoAutorizacion: r.CODIGO_AUTORIZACION || '',
  tipoTarjeta: r.TIPO_TARJETA || '',
  ultimos4: r.ULTIMOS4 || '',
  cuotas: r.CUOTAS ?? null,
  montoReembolsado: r.MONTO_REEMBOLSADO || 0,
  usuario: r.USUARIO || '',
  idUsuario: r.ID_USUARIO ?? null,
  detalle: r.DETALLE || '',
  fecha: r.FECHA_CREACION
});

const COLUMNAS = `id_pago, id_pedido, metodo, proveedor, monto, estado, codigo_autorizacion, tipo_tarjeta, ultimos4, cuotas,
       monto_reembolsado, id_usuario, usuario, detalle, fecha_creacion`;

// ORA-00001 en el índice único: otro cobro se adelantó
const siEsDuplicado = (error) => {
  if (error.errorNum === 1) throw new ErrorApp(409, 'Este pedido ya está pagado.');
  throw error;
};


/* ---------- Pedido a cobrar ---------- */

async function pedidoParaCobrar(db, idPedido) {
  const { rows } = await db.ejecutar(`/* pago_pedido */ SELECT id_pedido, total, estado FROM pedido WHERE id_pedido = :id`, { id: idPedido });

  if (!rows.length) throw new ErrorApp(404, 'El pedido no existe.');
  if (rows[0].ESTADO === 'CANCELADO') throw new ErrorApp(409, 'El pedido está cancelado: no se puede cobrar.');

  const monto = Math.round(Number(rows[0].TOTAL));
  if (!Number.isInteger(monto) || monto <= 0) throw new ErrorApp(409, 'El pedido no tiene un total válido para cobrar.');

  const { rows: pagados } = await db.ejecutar(`/* pago_autorizado_de_pedido */ SELECT id_pago FROM pago WHERE id_pedido = :id AND estado = 'AUTORIZADO'`, { id: idPedido });
  if (pagados.length) throw new ErrorApp(409, 'Este pedido ya está pagado.');

  return { idPedido, monto };
}

const datosUsuario = (usuario) => ({ idUsuario: usuario.id ?? null, usuario: usuario.usuario ?? null });


/* ---------- Efectivo ---------- */

export async function pagarEnEfectivo(db, usuario, { idPedido, recibido }) {
  const { monto } = await pedidoParaCobrar(db, idPedido);

  if (recibido !== undefined && recibido < monto) throw new ErrorApp(400, 'El monto recibido no alcanza para pagar el pedido.');

  let idPago;

  try {
    const resultado = await db.ejecutar(`
      /* pago_crear_efectivo */
      INSERT INTO pago (id_pedido, metodo, proveedor, monto, estado, id_usuario, usuario)
      VALUES (:idPedido, 'EFECTIVO', 'MANUAL', :monto, 'AUTORIZADO', :idUsuario, :usuario)
      RETURNING id_pago INTO :id`, { idPedido, monto, ...datosUsuario(usuario), id: db.salidaNumero });

    idPago = primerValor(resultado.outBinds.id);
  } catch (error) {
    siEsDuplicado(error);
  }

  const pago = { id: idPago, idPedido, metodo: 'EFECTIVO', proveedor: 'MANUAL', monto, estado: 'AUTORIZADO', idUsuario: usuario.id ?? null, usuario: usuario.usuario ?? '' };
  alertarPago(pago);

  return { ...pago, vuelto: recibido !== undefined ? recibido - monto : null };
}


/* ---------- Tarjeta (Webpay) ---------- */

export async function iniciarPagoTarjeta(db, proveedor, config, usuario, idPedido) {
  const { monto } = await pedidoParaCobrar(db, idPedido);

  // Un intento anterior sin terminar queda abandonado: si el cliente igual lo completa, no se confirmará
  await db.ejecutar(`/* pago_abandonar_previos */ UPDATE pago SET estado = 'ABANDONADO', fecha_actualizacion = SYSTIMESTAMP WHERE id_pedido = :id AND estado = 'CREADO'`, { id: idPedido });

  // buy_order: máximo 26 caracteres y único para cada intento
  const buyOrder = `BM${String(idPedido).padStart(8, '0')}${randomBytes(4).toString('hex')}`;
  const proveedorBd = proveedor.nombre === 'transbank' ? 'TRANSBANK' : 'SIMULADO';

  const resultado = await db.ejecutar(`
    /* pago_crear_tarjeta */
    INSERT INTO pago (id_pedido, metodo, proveedor, monto, estado, buy_order, id_usuario, usuario)
    VALUES (:idPedido, 'WEBPAY', :proveedor, :monto, 'CREADO', :buyOrder, :idUsuario, :usuario)
    RETURNING id_pago INTO :id`, { idPedido, proveedor: proveedorBd, monto, buyOrder, ...datosUsuario(usuario), id: db.salidaNumero });

  const idPago = primerValor(resultado.outBinds.id);

  try {
    const { token, url } = await proveedor.crear({
      buyOrder,
      sessionId: `U${usuario.id ?? 0}`,
      monto,
      urlRetorno: `${config.urlPublicaApi}/api/pagos/retorno`
    });

    await db.ejecutar(`/* pago_guardar_token */ UPDATE pago SET token = :token, fecha_actualizacion = SYSTIMESTAMP WHERE id_pago = :id`, { token, id: idPago });

    return { idPago, idPedido, monto, token, url, proveedor: proveedor.nombre };
  } catch (error) {
    await db.ejecutar(`/* pago_marcar */ UPDATE pago SET estado = 'RECHAZADO', detalle = :detalle, fecha_actualizacion = SYSTIMESTAMP WHERE id_pago = :id`, { detalle: 'No se pudo iniciar la transacción', id: idPago });
    throw error;
  }
}

async function pagoPorToken(db, token) {
  const { rows } = await db.ejecutar(`/* pago_por_token */ SELECT ${COLUMNAS}, token, buy_order FROM pago WHERE token = :token`, { token });
  return rows[0] ? { ...aPago(rows[0]), token: rows[0].TOKEN, buyOrder: rows[0].BUY_ORDER } : null;
}

const RESULTADO_POR_ESTADO = { AUTORIZADO: 'autorizado', RECHAZADO: 'rechazado', ANULADO: 'autorizado', EXPIRADO: 'rechazado', ABANDONADO: 'cancelado', CONFIRMANDO: 'pendiente', CREADO: 'pendiente' };

function resultadoDe(pago) {
  return { resultado: RESULTADO_POR_ESTADO[pago.estado] || 'desconocido', idPedido: pago.idPedido, idPago: pago.id };
}

async function terminarPago(db, pago, estado, campos = {}) {
  await db.ejecutar(`
    /* pago_terminar */
    UPDATE pago SET estado = :estado, codigo_autorizacion = :autorizacion, codigo_respuesta = :respuesta, tipo_tarjeta = :tipo,
                    ultimos4 = :ultimos4, cuotas = :cuotas, detalle = :detalle, fecha_actualizacion = SYSTIMESTAMP
     WHERE id_pago = :id`,
  {
    estado, id: pago.id, autorizacion: campos.codigoAutorizacion ?? null, respuesta: campos.codigoRespuesta ?? null,
    tipo: campos.tipoTarjeta ?? null, ultimos4: campos.ultimos4 ?? null, cuotas: campos.cuotas ?? null, detalle: campos.detalle ?? null
  });

  const terminado = { ...pago, estado, ...campos };

  registrarAuditoria(db, {
    usuario: pago.usuario || 'webpay', rol: 'sistema', accion: estado === 'AUTORIZADO' ? 'PAGO_AUTORIZADO' : 'PAGO_RECHAZADO', entidad: 'PAGO',
    idEntidad: pago.id, resultado: estado === 'AUTORIZADO' ? 'EXITO' : 'FALLO', detalle: `Pedido ${pago.idPedido} · $${pago.monto}${campos.detalle ? ` · ${campos.detalle}` : ''}`
  });
  alertarPago(terminado);

  return terminado;
}

/*
  Cuando Webpay devuelve al cliente al sitio. Puede traer:
    token_ws                       → el cliente pagó o falló el pago: hay que confirmar con Transbank
    TBK_TOKEN (+ TBK_ORDEN_COMPRA) → el cliente anuló, se agotó el tiempo o hubo un error en el formulario
*/
export async function procesarRetorno(db, proveedor, config, params) {
  const tokenWs = typeof params.token_ws === 'string' ? params.token_ws : '';
  const tokenAbandono = typeof params.TBK_TOKEN === 'string' ? params.TBK_TOKEN : '';

  // ----- El cliente no completó el pago -----
  if (tokenAbandono) {
    const pago = FORMATO_TOKEN.test(tokenAbandono) ? await pagoPorToken(db, tokenAbandono) : null;
    if (!pago) return { resultado: 'desconocido' };

    await db.ejecutar(`/* pago_abandonar */ UPDATE pago SET estado = 'ABANDONADO', detalle = 'El cliente no completó el pago', fecha_actualizacion = SYSTIMESTAMP WHERE id_pago = :id AND estado = 'CREADO'`, { id: pago.id });
    return { resultado: 'cancelado', idPedido: pago.idPedido, idPago: pago.id };
  }

  if (!FORMATO_TOKEN.test(tokenWs)) return { resultado: 'desconocido' };

  // ----- El cliente pagó: confirmar (solo una vez) -----
  const bloqueo = await db.ejecutar(`/* pago_bloquear */ UPDATE pago SET estado = 'CONFIRMANDO', fecha_actualizacion = SYSTIMESTAMP WHERE token = :token AND estado = 'CREADO'`, { token: tokenWs });
  const pago = await pagoPorToken(db, tokenWs);

  if (!pago) return { resultado: 'desconocido' };
  if (!bloqueo.rowsAffected) return resultadoDe(pago);            // ya se había procesado: se muestra el resultado de siempre

  const edadMs = Date.now() - new Date(pago.fecha).getTime();
  if (edadMs > config.minutosExpiracion * 60000) {
    await terminarPago(db, pago, 'EXPIRADO', { detalle: 'Se pagó después del tiempo permitido' });   // Transbank lo reversa solo al no confirmarse
    return { resultado: 'rechazado', idPedido: pago.idPedido, idPago: pago.id };
  }

  let respuesta;

  try {
    respuesta = await proveedor.confirmar(tokenWs);
  } catch (error) {
    // No sabemos si Transbank llegó a cobrar: se consulta su estado real
    try {
      respuesta = await proveedor.estado(tokenWs);
    } catch {
      logger.error('pago_sin_confirmar', { idPago: pago.id, motivo: error.message });
      return { resultado: 'pendiente', idPedido: pago.idPedido, idPago: pago.id };     // lo resuelve la conciliación
    }
  }

  return aplicarRespuesta(db, proveedor, pago, respuesta);
}

async function aplicarRespuesta(db, proveedor, pago, r) {
  if (r.aprobado && (r.monto !== pago.monto || (r.buyOrder && pago.buyOrder && r.buyOrder !== pago.buyOrder))) {
    // Cobraron algo distinto a lo esperado: se devuelve el dinero y no se da por pagado
    logger.error('pago_monto_distinto', { idPago: pago.id, esperado: pago.monto, cobrado: r.monto });
    try { await proveedor.reembolsar(pago.token, r.monto); } catch (error) { logger.error('pago_reembolso_fallido', { idPago: pago.id, motivo: error.message }); }

    await terminarPago(db, pago, 'RECHAZADO', { ...r, detalle: 'El monto cobrado no coincide con el del pedido (se reembolsó)' });
    return { resultado: 'rechazado', idPedido: pago.idPedido, idPago: pago.id };
  }

  try {
    await terminarPago(db, pago, r.aprobado ? 'AUTORIZADO' : 'RECHAZADO', {
      ...r, detalle: r.aprobado ? null : `Rechazado por la pasarela (código ${r.codigoRespuesta})`
    });
  } catch (error) {
    if (error.errorNum === 1) {
      // El pedido ya tenía otro pago autorizado: este se devuelve
      try { await proveedor.reembolsar(pago.token, pago.monto); } catch (e) { logger.error('pago_reembolso_fallido', { idPago: pago.id, motivo: e.message }); }
      await db.ejecutar(`/* pago_marcar */ UPDATE pago SET estado = 'RECHAZADO', detalle = :detalle, fecha_actualizacion = SYSTIMESTAMP WHERE id_pago = :id`, { detalle: 'El pedido ya estaba pagado (se reembolsó)', id: pago.id });
      return { resultado: 'rechazado', idPedido: pago.idPedido, idPago: pago.id };
    }
    throw error;
  }

  return { resultado: r.aprobado ? 'autorizado' : 'rechazado', idPedido: pago.idPedido, idPago: pago.id };
}


/* ---------- Anular (reembolsar) ---------- */

export async function anularPago(db, proveedor, usuario, idPago) {
  const { rows } = await db.ejecutar(`/* pago_obtener */ SELECT ${COLUMNAS}, token FROM pago WHERE id_pago = :id`, { id: idPago });
  if (!rows.length) throw new ErrorApp(404, 'El pago no existe.');

  const pago = aPago(rows[0]);
  if (pago.estado !== 'AUTORIZADO') throw new ErrorApp(409, 'Solo se pueden anular los pagos autorizados.');

  if (pago.metodo === 'WEBPAY') {
    const reembolso = await proveedor.reembolsar(rows[0].TOKEN, pago.monto);
    if (!reembolso.ok) throw new ErrorApp(502, 'La pasarela no pudo anular el pago. Revísalo directamente en Transbank.');
  }

  // "AND estado = 'AUTORIZADO'" evita anular dos veces si dos personas hacen clic a la vez
  const resultado = await db.ejecutar(`
    /* pago_anular */
    UPDATE pago SET estado = 'ANULADO', monto_reembolsado = monto, detalle = :detalle, fecha_actualizacion = SYSTIMESTAMP
     WHERE id_pago = :id AND estado = 'AUTORIZADO'`, { detalle: `Anulado por ${usuario.usuario}`, id: idPago });

  if (!resultado.rowsAffected) throw new ErrorApp(409, 'El pago ya fue anulado.');

  const anulado = { ...pago, estado: 'ANULADO', montoReembolsado: pago.monto };
  alertarPago(anulado);

  return anulado;
}


/* ---------- Consultas ---------- */

// Estado de pago de varios pedidos a la vez (para mostrar "Pagado" en la lista de cocina)
export async function pagosDePedidos(db, ids) {
  const unicos = [...new Set(ids)].slice(0, 100);
  if (!unicos.length) return [];

  const binds = Object.fromEntries(unicos.map((id, i) => [`id${i}`, id]));
  const { rows } = await db.ejecutar(`
    /* pagos_de_pedidos */
    SELECT id_pedido, metodo, monto, estado FROM pago
     WHERE id_pedido IN (${unicos.map((_, i) => `:id${i}`).join(', ')}) AND estado NOT IN ('ABANDONADO', 'EXPIRADO')
     ORDER BY id_pago`, binds);

  const porPedido = new Map();
  for (const r of rows) {
    const actual = porPedido.get(r.ID_PEDIDO);
    if (!actual || actual.estado !== 'AUTORIZADO') porPedido.set(r.ID_PEDIDO, { idPedido: r.ID_PEDIDO, metodo: r.METODO, monto: r.MONTO, estado: r.ESTADO });
  }

  return [...porPedido.values()];
}

export async function historialPagos(db, { estado, limite = 100 } = {}) {
  const binds = { limite };
  let filtro = '';

  if (estado) { filtro = 'WHERE estado = :estado'; binds.estado = estado; }

  const { rows } = await db.ejecutar(`
    /* pagos_historial */
    SELECT ${COLUMNAS} FROM pago ${filtro}
     ORDER BY fecha_creacion DESC, id_pago DESC
     FETCH FIRST :limite ROWS ONLY`, binds);

  return rows.map(aPago);
}


/* ---------- Conciliación (cada pocos minutos) ---------- */

export async function conciliarPagos(db, proveedor, config) {
  // Intentos que nadie terminó
  await db.ejecutar(`
    /* pagos_expirar */
    UPDATE pago SET estado = 'EXPIRADO', detalle = 'No se completó a tiempo', fecha_actualizacion = SYSTIMESTAMP
     WHERE estado = 'CREADO' AND fecha_creacion < SYSTIMESTAMP - NUMTODSINTERVAL(:minutos, 'MINUTE')`, { minutos: config.minutosExpiracion });

  // Confirmaciones que quedaron a medias (se cortó la conexión): se consulta a la pasarela
  const { rows } = await db.ejecutar(`
    /* pagos_confirmando */
    SELECT ${COLUMNAS}, token, buy_order FROM pago
     WHERE estado = 'CONFIRMANDO' AND fecha_actualizacion < SYSTIMESTAMP - NUMTODSINTERVAL(5, 'MINUTE')`);

  for (const fila of rows) {
    const pago = { ...aPago(fila), token: fila.TOKEN, buyOrder: fila.BUY_ORDER };

    try {
      await aplicarRespuesta(db, proveedor, pago, await proveedor.estado(pago.token));
    } catch (error) {
      logger.error('conciliacion_fallida', { idPago: pago.id, motivo: error.message });
    }
  }

  return rows.length;
}

export function iniciarConciliacionPagos(db, proveedor, config, cadaMs = 10 * 60 * 1000) {
  const intervalo = setInterval(() => {
    conciliarPagos(db, proveedor, config).catch((error) => logger.error('conciliacion_fallida', { motivo: error.message }));
  }, cadaMs);

  intervalo.unref();
  return () => clearInterval(intervalo);
}
