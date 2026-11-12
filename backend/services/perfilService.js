/* ==========================================================
   PERFIL DEL USUARIO (quien tiene la sesión iniciada)
   Tarea #33: cambiar el propio nombre y la contraseña.
   ========================================================== */

import { ErrorApp } from './errores.js';
import { hashearClave, claveCorrecta } from './authService.js';
import { crearLimitador } from './limitador.js';


// Contraseña actual equivocada: máximo 5 intentos cada 15 minutos por usuario
const limitadorClave = crearLimitador({ max: 5, ventanaMs: 15 * 60 * 1000 });
export const reiniciarLimiteClave = () => limitadorClave.reiniciar();

const iniciales = (nombre) => String(nombre).trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join('');


export async function actualizarNombre(db, sesion, nombre) {
  const resultado = await db.ejecutar(`
    /* perfil_actualizar_nombre */
    UPDATE usuario SET nombre = :nombre WHERE id_usuario = :id AND activo = 1`, { nombre, id: sesion.id });

  if (!resultado.rowsAffected) throw new ErrorApp(404, 'El usuario no existe.');

  return { id: sesion.id, nombre, usuario: sesion.usuario, iniciales: iniciales(nombre), rol: sesion.rol };
}

export async function cambiarClave(db, sesion, { claveActual, claveNueva }) {
  const { rows } = await db.ejecutar(`/* perfil_clave_actual */ SELECT contrasena_hash FROM usuario WHERE id_usuario = :id AND activo = 1`, { id: sesion.id });

  if (!rows.length) throw new ErrorApp(404, 'El usuario no existe.');

  limitadorClave.revisar(sesion.id);              // lanza 429 si ya se pasó de intentos

  if (!claveCorrecta(claveActual, rows[0].CONTRASENA_HASH)) {
    limitadorClave.registrar(sesion.id);
    throw new ErrorApp(400, 'La contraseña actual no es correcta.');
  }

  if (claveActual === claveNueva) throw new ErrorApp(400, 'La contraseña nueva debe ser distinta de la actual.');

  await db.ejecutar(`/* perfil_cambiar_clave */ UPDATE usuario SET contrasena_hash = :hash WHERE id_usuario = :id`, { hash: hashearClave(claveNueva), id: sesion.id });

  limitadorClave.reiniciar(sesion.id);
}
