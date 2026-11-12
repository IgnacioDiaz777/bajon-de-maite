/* ==========================================================
   PRUEBAS DEL SPRINT 4  →  npm test
     #29 Auditoría y logs · #28 Feedback · #27 Monitoreo · #30 Respaldo
   Usan la base de datos falsa (tests/dbFalsa.js): comprueban la
   lógica de la API, NO prueban Oracle real.
   ========================================================== */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const carpetaRespaldos = mkdtempSync(path.join(tmpdir(), 'bajon-respaldos-'));

process.env.JWT_SECRET = 'clave-solo-para-pruebas-0123456789-abcdefghij';
process.env.LOG_ARCHIVO = '0';
process.env.RESPALDO_DIR = carpetaRespaldos;
process.env.RESPALDO_MAX = '3';

const { crearApp } = await import('../app.js');
const { crearDbFalsa } = await import('./dbFalsa.js');
const { registrarAuditoria } = await import('../services/auditService.js');
const { reiniciarLimiteEnvios } = await import('../services/feedbackService.js');
const { percentil, crearMedidor } = await import('../services/monitorService.js');
const backup = await import('../services/backupService.js');


let servidor;
let base;
let db;


before(async () => {
  db = crearDbFalsa();

  db.agregarUsuario('Maite López', 'maite', 'Maite1234', 'administrador');
  db.agregarUsuario('Camila Soto', 'camila', 'Cajera2026', 'cajero');
  db.agregarUsuario('Pedro Cocina', 'pedro', 'Cocina2026', 'cocinero');

  db.agregarProducto('La Doble Maite', 6990, 12, 'COMIDA');     // id 1
  db.agregarProducto('Papas con todo', 3990, 20, 'COMIDA');     // id 2
  db.agregarProducto('Bebidas', 1200, 60, 'BEBIDA');            // id 3

  servidor = crearApp({ db }).listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://localhost:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  rmSync(carpetaRespaldos, { recursive: true, force: true });
});


async function api(metodo, ruta, cuerpo, token) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });

  return { estado: respuesta.status, datos: await respuesta.json() };
}

async function entrar(usuario, password) {
  return (await api('POST', '/api/auth/login', { usuario, password })).datos.token;
}

// La auditoría se guarda cuando la respuesta termina: se espera un instante a que aparezca
async function esperarAuditoria(condicion) {
  for (let i = 0; i < 50; i += 1) {
    const fila = db.datos.auditoria.find(condicion);
    if (fila) return fila;
    await new Promise((ok) => setTimeout(ok, 10));
  }

  return undefined;
}


/* ==========================================================
   #29 AUDITORÍA Y LOGS DE TRANSACCIONES
   ========================================================== */

test('auditoría: el login correcto y el fallido quedan registrados, sin la contraseña', async () => {
  await api('POST', '/api/auth/login', { usuario: 'maite', password: 'Maite1234' });
  await api('POST', '/api/auth/login', { usuario: 'maite', password: 'ClaveMala999' });

  const bueno = await esperarAuditoria((a) => a.ACCION === 'LOGIN' && a.RESULTADO === 'EXITO' && a.USUARIO === 'maite');
  const malo = await esperarAuditoria((a) => a.ACCION === 'LOGIN' && a.RESULTADO === 'FALLO' && a.USUARIO === 'maite');

  assert.ok(bueno);
  assert.equal(bueno.ROL, 'administrador');
  assert.ok(malo);
  assert.match(malo.DETALLE, /^401/);
  assert.ok(!JSON.stringify(db.datos.auditoria).includes('ClaveMala999'));
  assert.ok(!JSON.stringify(db.datos.auditoria).includes('Maite1234'));
});

test('auditoría: crear un producto registra quién, qué y el id; un cajero sin permiso queda como FALLO', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const nuevo = { nombre: 'Completo italiano', descripcion: 'Palta y tomate', precio: 3500, stock: 10, categoria: 'COMIDA' };

  const creado = await api('POST', '/api/productos', nuevo, admin);
  const id = String(creado.datos.data.id);

  const ok = await esperarAuditoria((a) => a.ACCION === 'PRODUCTO_CREAR' && a.RESULTADO === 'EXITO');
  assert.equal(ok.USUARIO, 'maite');
  assert.equal(ok.ID_ENTIDAD, id);
  assert.match(ok.DETALLE, /Completo italiano/);

  assert.equal((await api('POST', '/api/productos', nuevo, cajero)).estado, 403);
  const denegado = await esperarAuditoria((a) => a.ACCION === 'PRODUCTO_CREAR' && a.RESULTADO === 'FALLO');
  assert.equal(denegado.USUARIO, 'camila');
  assert.match(denegado.DETALLE, /^403/);
});

test('auditoría: los pedidos (crear y avanzar) y la creación de usuarios quedan registrados', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');
  const admin = await entrar('maite', 'Maite1234');

  const pedido = await api('POST', '/api/pedidos', { nombreCliente: 'Ana', tipoEntrega: 'Mesa 01', productos: [{ productoId: 2, cantidad: 1 }] }, cajero);
  const numero = String(pedido.datos.data.numero);

  const creado = await esperarAuditoria((a) => a.ACCION === 'PEDIDO_CREAR' && a.ID_ENTIDAD === numero);
  assert.equal(creado.USUARIO, 'camila');
  assert.match(creado.DETALLE, /Ana/);

  await api('POST', `/api/pedidos/${numero}/avanzar`, null, cocinero);
  const avanzado = await esperarAuditoria((a) => a.ACCION === 'PEDIDO_AVANZAR' && a.ID_ENTIDAD === numero);
  assert.equal(avanzado.USUARIO, 'pedro');
  assert.match(avanzado.DETALLE, /Listo/);

  await api('POST', '/api/usuarios', { nombre: 'Luis Parra', usuario: 'luis', password: 'Luis2026ok', rol: 'cocinero' }, admin);
  const usuario = await esperarAuditoria((a) => a.ACCION === 'USUARIO_CREAR');
  assert.match(usuario.DETALLE, /luis/);
  assert.ok(!usuario.DETALLE.includes('Luis2026ok'));          // nunca la contraseña
});

test('auditoría: solo el administrador consulta, con filtros y validación', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');

  assert.equal((await api('GET', '/api/auditoria', null, cajero)).estado, 403);
  assert.equal((await api('GET', '/api/auditoria')).estado, 401);

  const todos = await api('GET', '/api/auditoria', null, admin);
  assert.equal(todos.estado, 200);
  assert.ok(todos.datos.data.length >= 5);
  assert.ok(todos.datos.data[0].id > todos.datos.data[todos.datos.data.length - 1].id);   // el más nuevo primero

  const fallos = await api('GET', '/api/auditoria?resultado=FALLO&accion=LOGIN', null, admin);
  assert.ok(fallos.datos.data.length >= 1);
  assert.ok(fallos.datos.data.every((a) => a.resultado === 'FALLO' && a.accion === 'LOGIN'));

  const deCamila = await api('GET', '/api/auditoria?usuario=CAMILA', null, admin);
  assert.ok(deCamila.datos.data.every((a) => a.usuario === 'camila'));

  const limitado = await api('GET', '/api/auditoria?limite=2', null, admin);
  assert.equal(limitado.datos.data.length, 2);

  const hoy = new Date().toISOString().slice(0, 10);
  assert.equal((await api('GET', `/api/auditoria?desde=${hoy}&hasta=${hoy}`, null, admin)).estado, 200);

  assert.equal((await api('GET', '/api/auditoria?desde=10-11-2026', null, admin)).estado, 400);
  assert.equal((await api('GET', '/api/auditoria?resultado=TAL_VEZ', null, admin)).estado, 400);
  assert.equal((await api('GET', '/api/auditoria?accion=x;DROP', null, admin)).estado, 400);
});

test('auditoría: si la base falla, registrarAuditoria no lanza error (la operación del usuario sigue)', async () => {
  const dbRota = { ejecutar: async () => { throw Object.assign(new Error('ORA-00942: table or view does not exist'), { errorNum: 942 }); } };

  await assert.doesNotReject(() => registrarAuditoria(dbRota, { usuario: 'x', accion: 'PRUEBA' }));
});

test('auditoría: ORA-00942 (falta crear las tablas) responde 503 con instrucciones, sin detalles de Oracle', async () => {
  const dbSinTablas = { ...db, ejecutar: async () => { throw Object.assign(new Error('ORA-00942: table or view does not exist'), { errorNum: 942 }); } };
  const app = crearApp({ db: dbSinTablas }).listen(0);
  await new Promise((ok) => app.once('listening', ok));

  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ id: 1, usuario: 'maite', rol: 'administrador' }, process.env.JWT_SECRET);

  const r = await fetch(`http://localhost:${app.address().port}/api/auditoria`, { headers: { Authorization: `Bearer ${token}` } });
  const datos = await r.json();
  app.close();

  assert.equal(r.status, 503);
  assert.match(datos.errors[0], /crear-tablas/);
  assert.ok(!JSON.stringify(datos).includes('ORA-'));
});


/* ==========================================================
   #28 FEEDBACK Y REPORTE DE FALLOS
   ========================================================== */

test('feedback: cualquier rol envía un fallo y la gravedad se guarda solo en los fallos', async () => {
  reiniciarLimiteEnvios();
  const cajero = await entrar('camila', 'Cajera2026');

  const fallo = await api('POST', '/api/feedback', { tipo: 'FALLO', gravedad: 'ALTA', titulo: 'No carga el menú', descripcion: 'Al abrir Productos se queda cargando', pantalla: 'productos' }, cajero);
  assert.equal(fallo.estado, 201);
  assert.equal(fallo.datos.data.estado, 'ABIERTO');
  assert.equal(db.datos.feedback.find((f) => f.ID_FEEDBACK === fallo.datos.data.id).GRAVEDAD, 'ALTA');

  const idea = await api('POST', '/api/feedback', { tipo: 'SUGERENCIA', gravedad: 'ALTA', titulo: 'Modo oscuro', descripcion: 'Sería bueno tener modo oscuro' }, cajero);
  assert.equal(idea.estado, 201);
  assert.equal(db.datos.feedback.find((f) => f.ID_FEEDBACK === idea.datos.data.id).GRAVEDAD, null);
  assert.equal(db.datos.feedback.find((f) => f.ID_FEEDBACK === idea.datos.data.id).ORIGEN, 'MANUAL');
});

test('feedback: validaciones (campos vacíos, tipo inválido, campos desconocidos) y sin sesión', async () => {
  reiniciarLimiteEnvios();
  const cocinero = await entrar('pedro', 'Cocina2026');

  const vacio = await api('POST', '/api/feedback', { tipo: 'FALLO', titulo: '', descripcion: '' }, cocinero);
  assert.equal(vacio.estado, 400);
  assert.ok(vacio.datos.errors.length >= 2);

  assert.equal((await api('POST', '/api/feedback', { tipo: 'QUEJA', titulo: 'Hola mundo', descripcion: 'Texto de prueba' }, cocinero)).estado, 400);
  assert.equal((await api('POST', '/api/feedback', { tipo: 'FALLO', titulo: 'Hola mundo', descripcion: 'Texto de prueba', estado: 'RESUELTO' }, cocinero)).estado, 400);
  assert.equal((await api('POST', '/api/feedback', { tipo: 'FALLO', titulo: 'Hola mundo', descripcion: 'x'.repeat(1001) }, cocinero)).estado, 400);
  assert.equal((await api('POST', '/api/feedback', { tipo: 'FALLO', titulo: 'Hola mundo', descripcion: 'Texto de prueba' })).estado, 401);
});

test('feedback: el administrador ve todo; los demás roles solo lo suyo; filtros por tipo y estado', async () => {
  reiniciarLimiteEnvios();
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  await api('POST', '/api/feedback', { tipo: 'COMENTARIO', titulo: 'Todo muy bien', descripcion: 'Me gusta la app de cocina' }, cocinero);

  const todos = await api('GET', '/api/feedback', null, admin);
  const deCamila = await api('GET', '/api/feedback', null, cajero);
  const deCocina = await api('GET', '/api/feedback', null, cocinero);

  assert.ok(todos.datos.data.length > deCamila.datos.data.length);
  assert.ok(deCamila.datos.data.length >= 2 && deCamila.datos.data.every((f) => f.usuario === 'camila'));
  assert.ok(deCocina.datos.data.length >= 1 && deCocina.datos.data.every((f) => f.usuario === 'pedro'));

  const soloFallos = await api('GET', '/api/feedback?tipo=FALLO', null, admin);
  assert.ok(soloFallos.datos.data.length >= 1 && soloFallos.datos.data.every((f) => f.tipo === 'FALLO'));

  assert.equal((await api('GET', '/api/feedback?estado=NADA', null, admin)).estado, 400);
});

test('feedback: solo el administrador cambia el estado; queda auditado y se marca la fecha de resolución', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const id = db.datos.feedback[0].ID_FEEDBACK;

  assert.equal((await api('PATCH', `/api/feedback/${id}/estado`, { estado: 'RESUELTO' }, cajero)).estado, 403);

  const r = await api('PATCH', `/api/feedback/${id}/estado`, { estado: 'RESUELTO' }, admin);
  assert.equal(r.estado, 200);
  assert.ok(db.datos.feedback.find((f) => f.ID_FEEDBACK === id).FECHA_RESOLUCION);

  await api('PATCH', `/api/feedback/${id}/estado`, { estado: 'EN_REVISION' }, admin);
  assert.equal(db.datos.feedback.find((f) => f.ID_FEEDBACK === id).FECHA_RESOLUCION, null);

  assert.equal((await api('PATCH', `/api/feedback/${id}/estado`, { estado: 'LISTO' }, admin)).estado, 400);
  assert.equal((await api('PATCH', '/api/feedback/99999/estado', { estado: 'RESUELTO' }, admin)).estado, 404);
  assert.equal((await api('PATCH', '/api/feedback/abc/estado', { estado: 'RESUELTO' }, admin)).estado, 400);

  assert.ok(await esperarAuditoria((a) => a.ACCION === 'FEEDBACK_ESTADO' && a.RESULTADO === 'EXITO' && /RESUELTO/.test(a.DETALLE)));
});

test('feedback: límite de envíos por hora (429) para que nadie llene la tabla', async () => {
  reiniciarLimiteEnvios();
  const cocinero = await entrar('pedro', 'Cocina2026');
  const reporte = { tipo: 'FALLO', titulo: 'Se cayó otra vez', descripcion: 'Error automático repetido', origen: 'AUTOMATICO' };

  for (let i = 0; i < 20; i += 1) assert.equal((await api('POST', '/api/feedback', reporte, cocinero)).estado, 201);

  const exceso = await api('POST', '/api/feedback', reporte, cocinero);
  assert.equal(exceso.estado, 429);

  reiniciarLimiteEnvios();
});


/* ==========================================================
   #27 MONITOREO DE RENDIMIENTO
   ========================================================== */

test('monitoreo: percentiles', () => {
  const valores = Array.from({ length: 100 }, (_, i) => i + 1);

  assert.equal(percentil(valores, 50), 50);
  assert.equal(percentil(valores, 95), 95);
  assert.equal(percentil(valores, 100), 100);
  assert.equal(percentil([], 95), 0);
  assert.equal(percentil([7], 99), 7);
});

test('monitoreo: el medidor cuenta solicitudes, errores, lentas y agrupa por ruta', () => {
  let reloj = 1_000_000;
  const medidor = crearMedidor({ umbralLentoMs: 500, ahora: () => reloj });

  medidor.registrar({ ruta: 'GET /api/productos', estado: 200, duracionMs: 20 });
  medidor.registrar({ ruta: 'GET /api/productos', estado: 200, duracionMs: 40 });
  medidor.registrar({ ruta: 'POST /api/pedidos', estado: 500, duracionMs: 900 });
  medidor.registrar({ ruta: 'POST /api/pedidos', estado: 409, duracionMs: 30 });

  reloj += 61_000;                                         // pasó más de un minuto
  medidor.registrar({ ruta: 'GET /api/productos', estado: 200, duracionMs: 10 });

  const r = medidor.resumen();

  assert.equal(r.solicitudes.total, 5);
  assert.equal(r.solicitudes.ultimoMinuto, 1);
  assert.equal(r.solicitudes.errores5xx, 1);
  assert.equal(r.solicitudes.errores4xx, 1);
  assert.equal(r.solicitudes.lentas, 1);

  const productos = r.rutas.find((x) => x.ruta === 'GET /api/productos');
  assert.equal(productos.solicitudes, 3);
  assert.equal(productos.maxMs, 40);
  assert.equal(r.rutas[0].ruta, 'POST /api/pedidos');     // la más lenta primero

  medidor.reiniciar();
  assert.equal(medidor.resumen().solicitudes.total, 0);
});

test('monitoreo: GET /api/monitoreo (solo administrador) muestra rutas, memoria y latencia de la base', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');

  await api('GET', '/api/productos', null, admin);
  await api('POST', '/api/pedidos/99999/avanzar', null, cajero);   // 404: la ruta se agrupa como ":id"

  assert.equal((await api('GET', '/api/monitoreo', null, cajero)).estado, 403);
  assert.equal((await api('GET', '/api/monitoreo')).estado, 401);

  const r = await api('GET', '/api/monitoreo', null, admin);
  assert.equal(r.estado, 200);

  const m = r.datos.data;
  assert.equal(m.baseDeDatos.estado, 'ok');
  assert.equal(typeof m.baseDeDatos.latenciaMs, 'number');
  assert.ok(m.servidor.memoriaMB.rss > 0);
  assert.ok(m.solicitudes.total > 0);
  assert.ok(m.rutas.some((x) => x.ruta === 'GET /api/productos'));
  assert.ok(m.rutas.some((x) => x.ruta === 'POST /api/pedidos/:id/avanzar'));
  assert.ok(m.rutas.every((x) => typeof x.p95Ms === 'number' && x.solicitudes > 0));
});

test('monitoreo: si Oracle no responde, la latencia se informa como "sin conexión" (no se cae el monitoreo)', async () => {
  const dbCaida = { ...db, ejecutar: async () => { throw new Error('NJS-503'); } };
  const app = crearApp({ db: dbCaida }).listen(0);
  await new Promise((ok) => app.once('listening', ok));

  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ id: 1, usuario: 'maite', rol: 'administrador' }, process.env.JWT_SECRET);

  const r = await fetch(`http://localhost:${app.address().port}/api/monitoreo`, { headers: { Authorization: `Bearer ${token}` } });
  const datos = await r.json();
  app.close();

  assert.equal(r.status, 200);
  assert.equal(datos.data.baseDeDatos.estado, 'sin conexión');
  assert.equal(datos.data.baseDeDatos.latenciaMs, null);
});

test('monitoreo: reiniciar las mediciones', async () => {
  const admin = await entrar('maite', 'Maite1234');

  assert.equal((await api('POST', '/api/monitoreo/reiniciar', null, admin)).estado, 200);

  const r = await api('GET', '/api/monitoreo', null, admin);
  assert.ok(r.datos.data.solicitudes.total <= 3);       // solo quedan las solicitudes hechas después de reiniciar
});


/* ==========================================================
   #30 RESPALDO AUTOMÁTICO (BACKUP Y RESTORE)
   ========================================================== */

const archivosDeRespaldo = () => readdirSync(carpetaRespaldos).filter((n) => n.endsWith('.json'));

function reescribirRespaldo(archivo, cambiar) {
  const ruta = path.join(carpetaRespaldos, archivo);
  const contenido = JSON.parse(readFileSync(ruta, 'utf8'));

  cambiar(contenido);
  contenido.integridad = createHash('sha256').update(JSON.stringify(contenido.tablas)).digest('hex');
  writeFileSync(ruta, JSON.stringify(contenido));
}

test('respaldo: ordena las tablas respetando las claves foráneas', () => {
  const relaciones = [
    { hija: 'DETALLE_PEDIDO', padre: 'PEDIDO' }, { hija: 'DETALLE_PEDIDO', padre: 'PRODUCTO' },
    { hija: 'PEDIDO', padre: 'CLIENTE' }, { hija: 'CAJERO', padre: 'USUARIO' }, { hija: 'USUARIO', padre: 'USUARIO' },
    { hija: 'PEDIDO', padre: 'TABLA_QUE_NO_SE_RESTAURA' }
  ];

  const { orden, circular } = backup.ordenarPorDependencias(['DETALLE_PEDIDO', 'PEDIDO', 'CLIENTE', 'PRODUCTO', 'CAJERO', 'USUARIO'], relaciones);

  assert.equal(circular, false);
  assert.ok(orden.indexOf('CLIENTE') < orden.indexOf('PEDIDO'));
  assert.ok(orden.indexOf('PEDIDO') < orden.indexOf('DETALLE_PEDIDO'));
  assert.ok(orden.indexOf('PRODUCTO') < orden.indexOf('DETALLE_PEDIDO'));
  assert.ok(orden.indexOf('USUARIO') < orden.indexOf('CAJERO'));

  const ciclo = backup.ordenarPorDependencias(['A', 'B'], [{ hija: 'A', padre: 'B' }, { hija: 'B', padre: 'A' }]);
  assert.equal(ciclo.circular, true);
  assert.deepEqual([...ciclo.orden].sort(), ['A', 'B']);
});

test('respaldo: crea un archivo con todas las tablas existentes, huella SHA-256 y avisa las que faltan', async () => {
  const r = await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 });

  assert.match(r.archivo, /^respaldo-\d{8}-\d{6}(-\d+)?\.json$/);
  assert.equal(r.tablas.PRODUCTO, db.datos.productos.length);
  assert.equal(r.tablas.USUARIO, db.datos.usuarios.length);
  assert.equal(r.tablas.ADMINISTRADOR, 1);
  assert.ok(r.tablas.AUDITORIA > 0);                                   // el historial también se respalda
  assert.deepEqual(r.omitidas.sort(), ['REPORTE', 'VENTA']);          // no existen en la base falsa
  assert.ok(existsSync(path.join(carpetaRespaldos, r.archivo)));
  assert.ok(!readdirSync(carpetaRespaldos).some((n) => n.endsWith('.tmp')));

  const contenido = JSON.parse(readFileSync(path.join(carpetaRespaldos, r.archivo), 'utf8'));
  assert.equal(contenido.formato, 'bajon-respaldo');
  assert.equal(contenido.integridad, createHash('sha256').update(JSON.stringify(contenido.tablas)).digest('hex'));
});

test('respaldo: no se pueden hacer dos operaciones a la vez (409)', async () => {
  const [a, b] = await Promise.allSettled([
    backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 }),
    backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 })
  ]);

  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.equal(b.reason.estado, 409);
});

test('respaldo: conserva solo los últimos N y se ordena del más nuevo al más antiguo', async () => {
  for (let i = 0; i < 4; i += 1) await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 3 });

  const lista = await backup.listarRespaldos({ dir: carpetaRespaldos });
  const normales = lista.filter((r) => r.tipo === 'respaldo');

  assert.equal(normales.length, 3);
  assert.ok(normales.every((r) => r.tamanoBytes > 0 && r.creado));

  // Varios en el mismo segundo: el "-3" es más nuevo que el "-2" y que el original
  const numeros = normales.map((r) => Number((/-(\d+)\.json$/.exec(r.archivo) || [, 1])[1]));
  assert.deepEqual(numeros, [...numeros].sort((a, b) => b - a));
});

test('respaldo: la fecha de vencimiento para el respaldo automático', () => {
  const ahora = Date.parse('2026-11-10T12:00:00Z');

  assert.equal(backup.respaldoVencido(null, 24, ahora), true);
  assert.equal(backup.respaldoVencido('2026-11-09T11:59:00.000Z', 24, ahora), true);
  assert.equal(backup.respaldoVencido('2026-11-09T12:01:00.000Z', 24, ahora), false);
  assert.equal(backup.respaldoVencido('2026-11-10T11:30:00.000Z', 0.5, ahora), true);
});

test('restauración: devuelve los datos al momento del respaldo, no pisa el historial y guarda un respaldo de seguridad', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  await api('POST', '/api/pedidos', { nombreCliente: 'Respaldo', tipoEntrega: 'Para llevar', productos: [{ productoId: 1, cantidad: 2 }] }, cajero);

  const antes = JSON.parse(JSON.stringify({
    productos: db.datos.productos, usuarios: db.datos.usuarios, pedidos: db.datos.pedidos, detalles: db.datos.detalles,
    clientes: db.datos.clientes, roles: [...db.datos.roles]
  }));

  const respaldo = await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 });

  // Después del respaldo "pasan cosas": se borra y cambia información, y se agregan usuarios
  db.datos.productos.splice(0, db.datos.productos.length);
  db.datos.pedidos.splice(0, db.datos.pedidos.length);
  db.datos.detalles.splice(0, db.datos.detalles.length);
  db.agregarProducto('Producto intruso', 1000, 1, 'OTRO');
  db.agregarUsuario('Intruso', 'intruso', 'Intruso123', 'cajero');

  const auditoriaAntes = db.datos.auditoria.length;
  db.datos.borradas.length = 0;
  db.datos.insertadas.length = 0;

  const r = await backup.restaurarRespaldo(db, respaldo.archivo, { dir: carpetaRespaldos, max: 10 });

  assert.deepEqual(JSON.parse(JSON.stringify(db.datos.productos)), antes.productos);
  assert.deepEqual(JSON.parse(JSON.stringify(db.datos.usuarios)), antes.usuarios);
  assert.deepEqual(JSON.parse(JSON.stringify(db.datos.detalles)), antes.detalles);
  assert.deepEqual([...db.datos.roles], antes.roles);
  assert.equal(db.datos.pedidos.length, antes.pedidos.length);
  assert.ok(db.datos.pedidos[0].FECHA instanceof Date);                   // las fechas vuelven como fechas
  assert.ok(!db.datos.productos.some((p) => p.NOMBRE === 'Producto intruso'));

  // El historial (AUDITORIA) y los reportes NO se tocan
  assert.ok(db.datos.auditoria.length >= auditoriaAntes);
  assert.ok(!db.datos.borradas.includes('AUDITORIA') && !db.datos.borradas.includes('FEEDBACK'));

  // Orden: se borra primero lo que depende de otras tablas, y se inserta primero lo "padre"
  const b = db.datos.borradas;
  const i = db.datos.insertadas;
  assert.ok(b.indexOf('DETALLE_PEDIDO') < b.indexOf('PEDIDO') && b.indexOf('PEDIDO') < b.indexOf('CLIENTE'));
  assert.ok(b.indexOf('CAJERO') < b.indexOf('USUARIO'));
  assert.ok(i.indexOf('USUARIO') < i.indexOf('CAJERO'));
  assert.ok(i.indexOf('PRODUCTO') < i.indexOf('DETALLE_PEDIDO'));

  assert.match(r.respaldoDeSeguridad, /^seguridad-/);
  assert.ok(existsSync(path.join(carpetaRespaldos, r.respaldoDeSeguridad)));
  assert.equal(r.restauradas.PRODUCTO, antes.productos.length);
  assert.deepEqual(r.advertencias, []);
});

test('restauración: si falla a la mitad se deshace todo (los datos quedan como estaban)', async () => {
  const respaldo = await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 });

  db.agregarProducto('Producto posterior', 2500, 5, 'OTRO');
  const antes = JSON.stringify(db.datos.productos);
  const pedidosAntes = db.datos.pedidos.length;

  db.datos.fallarAlInsertar = 'PEDIDO';

  await assert.rejects(
    backup.restaurarRespaldo(db, respaldo.archivo, { dir: carpetaRespaldos, max: 10 }),
    (error) => error.estado === 500 && /quedaron como estaban/.test(error.message) && !/ORA-/.test(error.message)
  );

  db.datos.fallarAlInsertar = null;

  assert.equal(JSON.stringify(db.datos.productos), antes);
  assert.equal(db.datos.pedidos.length, pedidosAntes);
});

test('restauración: las columnas identity ALWAYS se ajustan solo durante la restauración y se dejan como estaban', async () => {
  db.datos.identidades.push({ TABLE_NAME: 'PRODUCTO', COLUMN_NAME: 'ID_PRODUCTO', GENERATION_TYPE: 'ALWAYS' });
  db.datos.ddl.length = 0;

  const respaldo = await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 });
  const r = await backup.restaurarRespaldo(db, respaldo.archivo, { dir: carpetaRespaldos, max: 10 });

  db.datos.identidades.length = 0;

  assert.equal(db.datos.ddl.length, 2);
  assert.match(db.datos.ddl[0], /ALTER TABLE PRODUCTO MODIFY \(ID_PRODUCTO GENERATED BY DEFAULT AS IDENTITY\)$/);
  assert.match(db.datos.ddl[1], /GENERATED ALWAYS AS IDENTITY \(START WITH LIMIT VALUE\)/);
  assert.deepEqual(r.advertencias, []);
});

test('restauración: rechaza archivos dañados, alterados, de otra estructura, con nombre inválido o inexistentes', async () => {
  const respaldo = await backup.crearRespaldo(db, { dir: carpetaRespaldos, max: 10 });
  const opciones = { dir: carpetaRespaldos, max: 10 };
  const antes = JSON.stringify(db.datos.productos);

  // Alterado a mano (la huella ya no calza)
  const copia = JSON.parse(readFileSync(path.join(carpetaRespaldos, respaldo.archivo), 'utf8'));
  copia.tablas.PRODUCTO.filas[0].PRECIO = 1;
  writeFileSync(path.join(carpetaRespaldos, 'respaldo-20200101-000001.json'), JSON.stringify(copia));
  await assert.rejects(backup.restaurarRespaldo(db, 'respaldo-20200101-000001.json', opciones), (e) => e.estado === 400 && /integridad/.test(e.message));

  // No es JSON
  writeFileSync(path.join(carpetaRespaldos, 'respaldo-20200101-000002.json'), '{esto no es json');
  await assert.rejects(backup.restaurarRespaldo(db, 'respaldo-20200101-000002.json', opciones), (e) => e.estado === 400 && /dañado/.test(e.message));

  // Otro tipo de archivo JSON
  writeFileSync(path.join(carpetaRespaldos, 'respaldo-20200101-000003.json'), JSON.stringify({ hola: 'mundo' }));
  await assert.rejects(backup.restaurarRespaldo(db, 'respaldo-20200101-000003.json', opciones), (e) => e.estado === 400);

  // La base ya no tiene una columna que el respaldo sí trae
  writeFileSync(path.join(carpetaRespaldos, 'respaldo-20200101-000004.json'), readFileSync(path.join(carpetaRespaldos, respaldo.archivo)));
  reescribirRespaldo('respaldo-20200101-000004.json', (c) => c.tablas.PRODUCTO.columnas.push({ nombre: 'COLUMNA_VIEJA', tipo: 'VARCHAR2' }));
  await assert.rejects(backup.restaurarRespaldo(db, 'respaldo-20200101-000004.json', opciones), (e) => e.estado === 409 && /COLUMNA_VIEJA/.test(e.message));

  // Nombres que intentan salirse de la carpeta o que no existen
  for (const malo of ['../.env', '..\\..\\secreto.json', 'respaldo-1.json', '/etc/passwd', 'otra-cosa.json']) {
    await assert.rejects(backup.restaurarRespaldo(db, malo, opciones), (e) => e.estado === 400, malo);
  }
  await assert.rejects(backup.restaurarRespaldo(db, 'respaldo-20990101-000000.json', opciones), (e) => e.estado === 404);

  assert.equal(JSON.stringify(db.datos.productos), antes);               // nada cambió
});

test('API respaldos: solo el administrador; crear, listar y restaurar con confirmación; todo queda auditado', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');

  assert.equal((await api('GET', '/api/respaldos', null, cajero)).estado, 403);
  assert.equal((await api('POST', '/api/respaldos', null, cajero)).estado, 403);
  assert.equal((await api('POST', '/api/respaldos/restaurar', { archivo: 'respaldo-20260101-000000.json', confirmar: 'RESTAURAR' }, cajero)).estado, 403);
  assert.equal((await api('GET', '/api/respaldos')).estado, 401);

  const creado = await api('POST', '/api/respaldos', null, admin);
  assert.equal(creado.estado, 201);
  const archivo = creado.datos.data.archivo;
  assert.ok(await esperarAuditoria((a) => a.ACCION === 'RESPALDO_CREAR' && a.ID_ENTIDAD === archivo));

  const lista = await api('GET', '/api/respaldos', null, admin);
  assert.ok(lista.datos.data.some((r) => r.archivo === archivo));

  // Restaurar sin confirmar o con datos inválidos
  assert.equal((await api('POST', '/api/respaldos/restaurar', { archivo }, admin)).estado, 400);
  assert.equal((await api('POST', '/api/respaldos/restaurar', { archivo, confirmar: 'si' }, admin)).estado, 400);
  assert.equal((await api('POST', '/api/respaldos/restaurar', { archivo: '../../etc/passwd', confirmar: 'RESTAURAR' }, admin)).estado, 400);
  assert.equal((await api('POST', '/api/respaldos/restaurar', { archivo: 'respaldo-20990101-000000.json', confirmar: 'RESTAURAR' }, admin)).estado, 404);

  db.agregarProducto('Se borra al restaurar', 1500, 3, 'OTRO');
  const restaurado = await api('POST', '/api/respaldos/restaurar', { archivo, confirmar: 'RESTAURAR' }, admin);

  assert.equal(restaurado.estado, 200);
  assert.ok(!db.datos.productos.some((p) => p.NOMBRE === 'Se borra al restaurar'));
  assert.ok(await esperarAuditoria((a) => a.ACCION === 'RESPALDO_RESTAURAR' && a.RESULTADO === 'EXITO' && a.ID_ENTIDAD === archivo));

  // Los fallos también se auditan
  assert.ok(await esperarAuditoria((a) => a.ACCION === 'RESPALDO_RESTAURAR' && a.RESULTADO === 'FALLO'));
});

test('respaldo automático: hace un respaldo cuando toca, lo audita y se puede detener; con 0 horas queda desactivado', async () => {
  const dirAuto = mkdtempSync(path.join(tmpdir(), 'bajon-auto-'));

  try {
    const detenerInactivo = backup.iniciarRespaldoAutomatico(db, { cadaHoras: 0, dir: dirAuto });
    await new Promise((ok) => setTimeout(ok, 60));
    assert.equal(readdirSync(dirAuto).length, 0);
    detenerInactivo();

    const detener = backup.iniciarRespaldoAutomatico(db, { cadaHoras: 24, dir: dirAuto, max: 3, primeraRevisionMs: 10 });
    await esperarAuditoria((a) => a.ACCION === 'RESPALDO_AUTOMATICO');
    detener();

    assert.equal(readdirSync(dirAuto).filter((n) => n.startsWith('respaldo-')).length, 1);
    const auditoria = db.datos.auditoria.find((a) => a.ACCION === 'RESPALDO_AUTOMATICO');
    assert.equal(auditoria.USUARIO, 'sistema');

    // Si ya hay uno reciente, no hace otro
    const detenerDeNuevo = backup.iniciarRespaldoAutomatico(db, { cadaHoras: 24, dir: dirAuto, max: 3, primeraRevisionMs: 10 });
    await new Promise((ok) => setTimeout(ok, 150));
    detenerDeNuevo();
    assert.equal(readdirSync(dirAuto).filter((n) => n.startsWith('respaldo-')).length, 1);
  } finally {
    rmSync(dirAuto, { recursive: true, force: true });
  }
});
