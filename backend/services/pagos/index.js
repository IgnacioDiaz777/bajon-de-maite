import { config } from '../../config/env.js';
import { crearProveedorTransbank } from './proveedorTransbank.js';
import { crearProveedorSimulado } from './proveedorSimulado.js';


// Crea el proveedor que indique PAGOS_PROVEEDOR (simulado o transbank)
export function crearProveedorPagos(configuracion = config.pagos) {
  return configuracion.proveedor === 'transbank'
    ? crearProveedorTransbank(configuracion)
    : crearProveedorSimulado(configuracion);
}
