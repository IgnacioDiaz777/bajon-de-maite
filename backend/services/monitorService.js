/* ==========================================================
   MONITOREO DE RENDIMIENTO
   Sprint 4 · #27 Monitoreo de rendimiento en carga

   Mide, en memoria, cuánto tarda cada ruta de la API y cuántas
   solicitudes fallan. Los datos se reinician al apagar el
   servidor (no se guardan en Oracle a propósito: medir no debe
   hacer más lenta a la app).

   Se consulta con GET /api/monitoreo (solo administrador).
   Para generar carga de prueba:  npm run prueba-carga
   ========================================================== */

import os from 'node:os';


const MUESTRAS_POR_RUTA = 500;       // últimos tiempos guardados por ruta (para percentiles)
const VENTANA_MS = 60 * 1000;        // "solicitudes por minuto"


/* ---------- Estadística (también la usa scripts/pruebaCarga.js) ---------- */

export function percentil(valores, p) {
  if (!valores.length) return 0;

  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);

  return ordenados[Math.max(0, indice)];
}

const redondear = (n) => Math.round(n * 10) / 10;


/* ---------- Medidor ---------- */

export function crearMedidor({ umbralLentoMs = 1000, ahora = () => Date.now() } = {}) {
  const inicio = ahora();
  const rutas = new Map();           // 'GET /api/productos' → { cuenta, errores, total, max, muestras: [] }
  const recientes = [];              // marcas de tiempo de la última ventana
  const global = { total: 0, errores4xx: 0, errores5xx: 0, lentas: 0 };

  function registrar({ ruta, estado, duracionMs }) {
    const marca = ahora();

    global.total += 1;
    if (estado >= 500) global.errores5xx += 1;
    else if (estado >= 400) global.errores4xx += 1;
    if (duracionMs > umbralLentoMs) global.lentas += 1;

    recientes.push(marca);
    while (recientes.length && recientes[0] < marca - VENTANA_MS) recientes.shift();

    let datos = rutas.get(ruta);
    if (!datos) {
      datos = { cuenta: 0, errores: 0, total: 0, max: 0, muestras: [] };
      rutas.set(ruta, datos);
    }

    datos.cuenta += 1;
    datos.total += duracionMs;
    datos.max = Math.max(datos.max, duracionMs);
    if (estado >= 500) datos.errores += 1;

    datos.muestras.push(duracionMs);
    if (datos.muestras.length > MUESTRAS_POR_RUTA) datos.muestras.shift();
  }

  function resumen() {
    const memoria = process.memoryUsage();
    const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

    return {
      servidor: {
        iniciado: new Date(inicio).toISOString(),
        activoSegundos: Math.round((ahora() - inicio) / 1000),
        node: process.version,
        memoriaMB: { rss: mb(memoria.rss), heapUsado: mb(memoria.heapUsed), heapTotal: mb(memoria.heapTotal) },
        cargaCpu: os.loadavg().map((n) => Math.round(n * 100) / 100),   // 1, 5 y 15 min (en Windows siempre 0)
        nucleos: os.cpus().length
      },
      solicitudes: {
        total: global.total,
        ultimoMinuto: recientes.filter((t) => t >= ahora() - VENTANA_MS).length,
        errores4xx: global.errores4xx,
        errores5xx: global.errores5xx,
        lentas: global.lentas,
        umbralLentoMs
      },
      rutas: [...rutas.entries()]
        .map(([ruta, d]) => ({
          ruta,
          solicitudes: d.cuenta,
          promedioMs: redondear(d.total / d.cuenta),
          p95Ms: redondear(percentil(d.muestras, 95)),
          maxMs: redondear(d.max),
          errores: d.errores
        }))
        .sort((a, b) => b.p95Ms - a.p95Ms)
    };
  }

  function reiniciar() {
    rutas.clear();
    recientes.length = 0;
    Object.assign(global, { total: 0, errores4xx: 0, errores5xx: 0, lentas: 0 });
  }

  return { registrar, resumen, reiniciar };
}


// Medidor único que usa la app
export const medidor = crearMedidor();


/* ---------- Latencia de la base de datos ---------- */

export async function medirBaseDeDatos(db) {
  const inicio = performance.now();

  try {
    await db.ejecutar('/* ping */ SELECT 1 AS ok FROM dual');
    return { estado: 'ok', latenciaMs: redondear(performance.now() - inicio) };
  } catch {
    return { estado: 'sin conexión', latenciaMs: null };
  }
}
