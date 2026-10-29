/* ==========================================================
   CONFIGURACIÓN
   Lee las variables de entorno (y el archivo .env si existe).
   Nunca se escriben credenciales en el código.
   ========================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';


/* ---------- Carga mínima del archivo .env (sin dependencias) ---------- */

const archivoEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (existsSync(archivoEnv)) {
  for (const linea of readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const texto = linea.trim();
    if (!texto || texto.startsWith('#') || !texto.includes('=')) continue;

    const indice = texto.indexOf('=');
    const clave = texto.slice(0, indice).trim();
    const valor = texto.slice(indice + 1).trim().replace(/^(['"])(.*)\1$/, '$2');

    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}


/* ---------- Configuración exportada ---------- */

export const config = {
  puerto: Number(process.env.PORT) || 3000,

  jwtSecreto: process.env.JWT_SECRET,
  jwtExpira: process.env.JWT_EXPIRA || '2h',

  // Orígenes del frontend permitidos (Live Server del equipo usa el puerto 5502)
  corsOrigenes: (process.env.CORS_ORIGENES
    || 'http://localhost:5502,http://127.0.0.1:5502,http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map((o) => o.trim()).filter(Boolean),

  oracle: {
    usuario: process.env.ORACLE_USER,
    clave: process.env.ORACLE_PASSWORD,
    conexion: process.env.ORACLE_CONNECT_STRING,
    esquema: process.env.ORACLE_SCHEMA || '',
    carteraDir: process.env.ORACLE_WALLET_DIR || '',
    carteraClave: process.env.ORACLE_WALLET_PASSWORD || ''
  }
};


/* ---------- Validación al arrancar ---------- */

export function validarConfig({ requiereOracle = true } = {}) {
  const faltantes = [];

  if (!config.jwtSecreto || config.jwtSecreto.length < 32) faltantes.push('JWT_SECRET (mínimo 32 caracteres)');

  if (requiereOracle) {
    if (!config.oracle.usuario) faltantes.push('ORACLE_USER');
    if (!config.oracle.clave) faltantes.push('ORACLE_PASSWORD');
    if (!config.oracle.conexion) faltantes.push('ORACLE_CONNECT_STRING');
  }

  if (faltantes.length) {
    throw new Error(`Falta configurar en backend/.env: ${faltantes.join(', ')}. Revisa .env.example`);
  }
}
