/* ==========================================================
   CONFIGURACIÓN
   Lee las variables de entorno (y el archivo .env si existe).
   Nunca se escriben credenciales en el código.
   ========================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';


/* ---------- Carga mínima del archivo .env (sin dependencias) ---------- */

const raizBackend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivoEnv = path.join(raizBackend, '.env');

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

// Lee un número de las variables de entorno; si falta o no es válido, usa el valor por defecto
function numeroEnv(nombre, porDefecto) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;

  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : porDefecto;
}


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
  },

  // Sprint 4 · #29 Auditoría y logs: archivos de registro (una línea JSON por evento)
  logs: {
    archivo: process.env.LOG_ARCHIVO !== '0',                          // LOG_ARCHIVO=0 desactiva los archivos
    dir: process.env.LOG_DIR || path.join(raizBackend, 'logs'),
    diasConservar: numeroEnv('LOG_DIAS', 30)
  },

  // Sprint 4 · #27 Monitoreo: una solicitud más lenta que esto se registra como "lenta"
  monitoreo: {
    umbralLentoMs: numeroEnv('MONITOREO_UMBRAL_MS', 1000) || 1000
  },

  // Tarea #32 Pasarela de pagos (Webpay Plus de Transbank)
  //   simulado   → pantalla de pago falsa, solo para desarrollo y pruebas (nunca en producción)
  //   transbank  → Webpay Plus real (ambiente "integracion" para pruebas, "produccion" con dinero real)
  pagos: {
    proveedor: (process.env.PAGOS_PROVEEDOR || 'simulado').toLowerCase(),
    ambiente: (process.env.TBK_AMBIENTE || 'integracion').toLowerCase(),
    codigoComercio: process.env.TBK_COMMERCE_CODE || '',
    llaveSecreta: process.env.TBK_API_KEY || '',
    urlPublicaApi: (process.env.BACKEND_PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/+$/, ''),
    urlFrontend: (process.env.FRONTEND_URL || (process.env.CORS_ORIGENES || 'http://localhost:5502').split(',')[0].trim()).replace(/\/+$/, ''),
    minutosExpiracion: numeroEnv('PAGOS_EXPIRA_MINUTOS', 30) || 30,
    produccion: process.env.NODE_ENV === 'production'
  },

  // Sprint 4 · #30 Respaldo y restauración
  respaldo: {
    dir: process.env.RESPALDO_DIR || path.join(raizBackend, 'respaldos'),
    cadaHoras: numeroEnv('RESPALDO_CADA_HORAS', 24),                   // 0 = sin respaldo automático
    max: numeroEnv('RESPALDO_MAX', 7) || 7                             // cuántos respaldos se conservan
  }
};


/* ---------- Validación al arrancar ---------- */

// Credenciales PÚBLICAS de prueba que Transbank publica para su ambiente de integración (no son secretas ni cobran dinero)
const TBK_INTEGRACION = { codigoComercio: '597055555532', llaveSecreta: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C' };

if (config.pagos.proveedor === 'transbank' && config.pagos.ambiente === 'integracion') {
  config.pagos.codigoComercio = config.pagos.codigoComercio || TBK_INTEGRACION.codigoComercio;
  config.pagos.llaveSecreta = config.pagos.llaveSecreta || TBK_INTEGRACION.llaveSecreta;
}

// Se exporta para poder probarla con distintas configuraciones
export function validarPagos(faltantes, p = config.pagos) {

  if (!['simulado', 'transbank'].includes(p.proveedor)) faltantes.push('PAGOS_PROVEEDOR (simulado o transbank)');
  if (!['integracion', 'produccion'].includes(p.ambiente)) faltantes.push('TBK_AMBIENTE (integracion o produccion)');

  if (p.proveedor === 'simulado' && (p.produccion || p.ambiente === 'produccion')) {
    faltantes.push('PAGOS_PROVEEDOR=transbank (el proveedor "simulado" no se puede usar en producción)');
  }

  if (p.proveedor === 'transbank' && p.ambiente === 'produccion') {
    if (!p.codigoComercio) faltantes.push('TBK_COMMERCE_CODE (código de comercio de producción)');
    if (!p.llaveSecreta) faltantes.push('TBK_API_KEY (llave secreta de producción)');
    if (!p.urlPublicaApi.startsWith('https://')) faltantes.push('BACKEND_PUBLIC_URL con https:// (Webpay exige HTTPS en producción)');
  }
}

export function validarConfig({ requiereOracle = true } = {}) {
  const faltantes = [];

  if (!config.jwtSecreto || config.jwtSecreto.length < 32) faltantes.push('JWT_SECRET (mínimo 32 caracteres)');

  if (requiereOracle) {
    if (!config.oracle.usuario) faltantes.push('ORACLE_USER');
    if (!config.oracle.clave) faltantes.push('ORACLE_PASSWORD');
    if (!config.oracle.conexion) faltantes.push('ORACLE_CONNECT_STRING');
  }

  validarPagos(faltantes);

  if (faltantes.length) {
    throw new Error(`Falta configurar en backend/.env: ${faltantes.join(', ')}. Revisa .env.example`);
  }
}
