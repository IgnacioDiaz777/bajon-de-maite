/* ==========================================================
   PROVEEDOR: SIMULADO (solo desarrollo y pruebas)
   Tarea #32 Integración de pasarela de pagos

   Imita a Webpay con una pantalla propia (/api/pagos/simulador)
   donde tú eliges "Aprobar", "Rechazar" o "Cancelar". Sirve para
   probar todo el flujo sin cuenta de Transbank.
   NUNCA se puede usar en producción (validarConfig lo impide).
   ========================================================== */

import { randomBytes } from 'node:crypto';


export function crearProveedorSimulado(configuracion) {
  const transacciones = new Map();      // token → { monto, buyOrder, decision, confirmada }

  return {
    nombre: 'simulado',

    async crear({ buyOrder, monto }) {
      const token = `SIM${randomBytes(24).toString('hex')}`;
      transacciones.set(token, { monto, buyOrder, decision: null, confirmada: false });

      return { token, url: `${configuracion.urlPublicaApi}/api/pagos/simulador` };
    },

    // Lo usa la pantalla simulada para guardar lo que eligió quien "paga"
    decidir(token, decision) {
      const t = transacciones.get(token);
      if (!t) return false;

      t.decision = decision;
      return true;
    },

    datosDe(token) {
      return transacciones.get(token) || null;
    },

    async confirmar(token) {
      const t = transacciones.get(token);
      if (!t) return { aprobado: false, estadoPasarela: 'FAILED', codigoRespuesta: -1 };

      t.confirmada = true;
      const aprobado = t.decision === 'aprobar';

      return {
        aprobado,
        estadoPasarela: aprobado ? 'AUTHORIZED' : 'FAILED',
        codigoRespuesta: aprobado ? 0 : -1,
        codigoAutorizacion: aprobado ? '1213' : null,
        tipoTarjeta: aprobado ? 'VN' : null,
        ultimos4: aprobado ? '6623' : null,
        cuotas: aprobado ? 0 : null,
        monto: t.monto,
        buyOrder: t.buyOrder
      };
    },

    async estado(token) {
      const t = transacciones.get(token);
      if (!t || !t.confirmada) return { aprobado: false, estadoPasarela: 'INITIALIZED', codigoRespuesta: null };

      return this.confirmar(token);
    },

    async reembolsar() {
      return { ok: true, tipo: 'REVERSED', codigoRespuesta: 0 };
    }
  };
}
