/* ==========================================================
   AUTENTICACIÓN
   Valida usuario y contraseña contra la tabla USUARIO y
   determina el rol según ADMINISTRADOR / CAJERO / COCINERO.
   ========================================================== */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ErrorApp } from './errores.js';


/* ---------- Contraseñas (nunca en texto plano) ---------- */

export function hashearClave(clave) {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(clave, sal, 64).toString('hex')}`; // 161 caracteres (columna: 255)
}

export function claveCorrecta(clave, guardada) {
  const [sal, hash] = String(guardada || '').split(':');
  if (!sal || !hash) return false;

  const esperado = Buffer.from(hash, 'hex');
  const calculado = scryptSync(clave, sal, esperado.length);

  return timingSafeEqual(calculado, esperado);
}

// Para tardar lo mismo cuando el usuario no existe (no revela qué usuarios hay)
const HASH_FALSO = hashearClave('clave-falsa-para-igualar-tiempos');


/* ---------- Inicio de sesión ---------- */

export async function autenticarUsuario(db, { usuario, password }) {
  const { rows } = await db.ejecutar(`
    /* usuario_por_nombre */
    SELECT u.id_usuario, u.nombre, u.nombre_usuario, u.contrasena_hash, u.activo,
           CASE WHEN a.id_usuario IS NOT NULL THEN 'administrador'
                WHEN c.id_usuario IS NOT NULL THEN 'cajero'
                WHEN k.id_usuario IS NOT NULL THEN 'cocinero'
           END AS rol
      FROM usuario u
      LEFT JOIN administrador a ON a.id_usuario = u.id_usuario
      LEFT JOIN cajero        c ON c.id_usuario = u.id_usuario
      LEFT JOIN cocinero      k ON k.id_usuario = u.id_usuario
     WHERE LOWER(u.nombre_usuario) = LOWER(:usuario)`, { usuario });

  const fila = rows[0];
  const valida = claveCorrecta(password, fila ? fila.CONTRASENA_HASH : HASH_FALSO);

  if (!fila || !valida) throw new ErrorApp(401, 'Usuario o contraseña incorrectos.');
  if (fila.ACTIVO !== 1) throw new ErrorApp(403, 'Este usuario está desactivado.');
  if (!fila.ROL) throw new ErrorApp(403, 'Este usuario no tiene un rol asignado.');

  return {
    id: fila.ID_USUARIO,
    nombre: fila.NOMBRE,
    usuario: fila.NOMBRE_USUARIO,
    iniciales: iniciales(fila.NOMBRE),
    rol: fila.ROL
  };
}

function iniciales(nombre) {
  return String(nombre).trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}
