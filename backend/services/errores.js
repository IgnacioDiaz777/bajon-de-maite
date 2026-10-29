/* ==========================================================
   ERRORES CONTROLADOS DE LA API
   ========================================================== */

export class ErrorApp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

/* Los RETURNING ... INTO de Oracle devuelven arreglos: [valor] */
export function primerValor(salida) {
  return Array.isArray(salida) ? salida[0] : salida;
}
