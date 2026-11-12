/* ==========================================================
   PRUEBA DE CARGA  →  npm run prueba-carga
   Sprint 4 · #27 Monitoreo de rendimiento en carga

   Lanza muchas solicitudes de LECTURA (GET) contra la API y
   mide cuánto tarda. No escribe datos. El servidor debe estar
   encendido (npm start).

     npm run prueba-carga -- --usuario maite
     npm run prueba-carga -- --usuario maite --solicitudes 500 --concurrencia 25 --ruta /api/pedidos

   Opciones (todas opcionales, salvo --usuario):
     --usuario       usuario con el que se inicia sesión
     --url           dirección del backend        (http://localhost:3000)
     --ruta          ruta GET a probar            (/api/productos)
     --solicitudes   cuántas solicitudes en total (200)
     --concurrencia  cuántas a la vez             (10)
     --umbral-p95    límite aceptable del p95, ms (1000)

   La contraseña se toma de la variable CARGA_CLAVE o se pide por pantalla.
   Termina con código 1 si hay errores o el p95 supera el umbral.
   ========================================================== */

import readline from 'node:readline';
import { percentil } from '../services/monitorService.js';


/* ---------- Opciones de la terminal ---------- */

function leerOpciones(argumentos) {
  const opciones = { url: 'http://localhost:3000', ruta: '/api/productos', solicitudes: 200, concurrencia: 10, 'umbral-p95': 1000 };

  for (let i = 0; i < argumentos.length; i += 2) {
    const nombre = argumentos[i] && argumentos[i].replace(/^--/, '');
    const valor = argumentos[i + 1];

    if (!nombre || valor === undefined) throw new Error(`Falta el valor de ${argumentos[i]}`);
    opciones[nombre] = ['solicitudes', 'concurrencia', 'umbral-p95'].includes(nombre) ? Number(valor) : valor;
  }

  return opciones;
}

function pedirClave() {
  return new Promise((resolver) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (texto) => { if (texto.includes('Contraseña')) process.stdout.write(texto); };   // oculta lo que se escribe
    rl.question('Contraseña: ', (clave) => { rl.close(); console.log(); resolver(clave); });
  });
}

const ms = (n) => `${n.toFixed(1)} ms`;


/* ---------- Prueba ---------- */

try {
  const o = leerOpciones(process.argv.slice(2));

  if (!o.usuario) throw new Error('Indica el usuario: npm run prueba-carga -- --usuario maite');
  if (!o.ruta.startsWith('/api/')) throw new Error('La ruta debe empezar con /api/');
  if (![o.solicitudes, o.concurrencia, o['umbral-p95']].every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error('--solicitudes, --concurrencia y --umbral-p95 deben ser números enteros mayores que 0.');
  }

  const password = process.env.CARGA_CLAVE || await pedirClave();

  // 1. Iniciar sesión
  const login = await fetch(`${o.url}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: o.usuario, password })
  });

  if (!login.ok) throw new Error(`No se pudo iniciar sesión (${login.status}). Revisa usuario y contraseña, y que el backend esté encendido.`);

  const { token } = await login.json();

  console.log(`\nProbando GET ${o.ruta}: ${o.solicitudes} solicitudes, ${o.concurrencia} a la vez…`);

  // 2. Lanzar las solicitudes con N "trabajadores" en paralelo
  const tiempos = [];
  const estados = new Map();
  let siguiente = 0;

  const trabajador = async () => {
    while (siguiente < o.solicitudes) {
      siguiente += 1;
      const inicio = performance.now();

      try {
        const r = await fetch(`${o.url}${o.ruta}`, { headers: { Authorization: `Bearer ${token}` } });
        await r.arrayBuffer();
        estados.set(r.status, (estados.get(r.status) || 0) + 1);
      } catch {
        estados.set('sin respuesta', (estados.get('sin respuesta') || 0) + 1);
      }

      tiempos.push(performance.now() - inicio);
    }
  };

  const desde = performance.now();
  await Promise.all(Array.from({ length: Math.min(o.concurrencia, o.solicitudes) }, trabajador));
  const totalMs = performance.now() - desde;

  // 3. Resultados
  const correctas = estados.get(200) || 0;
  const errores = o.solicitudes - correctas;
  const p95 = percentil(tiempos, 95);

  console.log('\nResultados');
  console.log(`  Solicitudes correctas   ${correctas} de ${o.solicitudes}  (${errores} con error)`);
  console.log(`  Tiempo total            ${(totalMs / 1000).toFixed(2)} s`);
  console.log(`  Solicitudes por segundo ${(o.solicitudes / (totalMs / 1000)).toFixed(1)}`);
  console.log(`  Mínimo / promedio       ${ms(Math.min(...tiempos))} / ${ms(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)}`);
  console.log(`  p50 / p95 / p99         ${ms(percentil(tiempos, 50))} / ${ms(p95)} / ${ms(percentil(tiempos, 99))}`);
  console.log(`  Máximo                  ${ms(Math.max(...tiempos))}`);
  console.log(`  Códigos de respuesta    ${[...estados.entries()].map(([c, n]) => `${c}: ${n}`).join(', ')}`);

  const aprobada = errores === 0 && p95 <= o['umbral-p95'];
  console.log(`\n${aprobada ? 'APROBADA' : 'NO APROBADA'}: sin errores y p95 ≤ ${o['umbral-p95']} ms.`);
  console.log('Más detalle por ruta en la pantalla Administración → Rendimiento (o GET /api/monitoreo).');

  process.exitCode = aprobada ? 0 : 1;
} catch (error) {
  console.error('No se pudo hacer la prueba:', error.message);
  process.exitCode = 1;
}
