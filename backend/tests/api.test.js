/* ==========================================================
   PRUEBAS DE LA API  →  npm test
   Usan una base de datos falsa en memoria (tests/dbFalsa.js).
   Comprueban la lógica de la API; NO prueban Oracle real.
   ========================================================== */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'clave-solo-para-pruebas-0123456789-abcdefghij';

const { crearApp } = await import('../app.js');
const { crearDbFalsa } = await import('./dbFalsa.js');


let servidor;
let base;
let db;


before(async () => {
  db = crearDbFalsa();

  db.agregarUsuario('Maite López', 'maite', 'Maite1234', 'administrador');
  db.agregarUsuario('Camila Soto', 'camila', 'Cajera2026', 'cajero');
  db.agregarUsuario('Pedro Cocina', 'pedro', 'Cocina2026', 'cocinero');
  db.agregarUsuario('Baja Usuario', 'baja', 'Baja12345', 'cajero', 0);

  db.agregarProducto('La Doble Maite', 6990, 12, 'COMIDA');     // id 1
  db.agregarProducto('Papas con todo', 3990, 20, 'COMIDA');     // id 2
  db.agregarProducto('Alitas picantes', 4990, 0, 'COMIDA');     // id 3
  db.agregarProducto('Bebidas', 1200, 60, 'BEBIDA');            // id 4

  servidor = crearApp({ db }).listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://localhost:${servidor.address().port}`;
});

after(() => servidor.close());


async function api(metodo, ruta, cuerpo, token) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });

  return { estado: respuesta.status, datos: await respuesta.json() };
}

async function entrar(usuario, password) {
  const r = await api('POST', '/api/auth/login', { usuario, password });
  return r.datos.token;
}


/* ---------- Sesión ---------- */

test('salud: la API responde y la base responde', async () => {
  const r = await api('GET', '/api/salud');
  assert.equal(r.estado, 200);
  assert.equal(r.datos.baseDeDatos, 'ok');
});

test('login correcto entrega token, usuario, iniciales y rol', async () => {
  const r = await api('POST', '/api/auth/login', { usuario: 'maite', password: 'Maite1234' });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.usuario.rol, 'administrador');
  assert.equal(r.datos.usuario.iniciales, 'ML');
  assert.ok(r.datos.token);
});

test('login: usuario inexistente y clave mala dan el mismo mensaje', async () => {
  const a = await api('POST', '/api/auth/login', { usuario: 'maite', password: 'MalaClave1' });
  const b = await api('POST', '/api/auth/login', { usuario: 'noexiste', password: 'MalaClave1' });
  assert.equal(a.estado, 401);
  assert.equal(b.estado, 401);
  assert.deepEqual(a.datos.errors, b.datos.errors);
});

test('login: campos vacíos devuelven los errores de validación', async () => {
  const r = await api('POST', '/api/auth/login', { usuario: '', password: '' });
  assert.equal(r.estado, 400);
  assert.equal(r.datos.errors.length, 2);
});

test('login: usuario desactivado no entra (403)', async () => {
  const r = await api('POST', '/api/auth/login', { usuario: 'baja', password: 'Baja12345' });
  assert.equal(r.estado, 403);
});

test('rutas protegidas sin token o con token falso devuelven 401', async () => {
  assert.equal((await api('GET', '/api/productos')).estado, 401);
  assert.equal((await api('GET', '/api/productos', null, 'token.falso.abc')).estado, 401);
});


/* ---------- Productos ---------- */

test('productos: todos los roles ven el menú', async () => {
  const token = await entrar('pedro', 'Cocina2026');
  const r = await api('GET', '/api/productos', null, token);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.data.length, 4);
  assert.equal(typeof r.datos.data[0].precio, 'number');
});

test('productos: solo el administrador crea, edita y elimina', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const admin = await entrar('maite', 'Maite1234');
  const nuevo = { nombre: 'Completo italiano', descripcion: 'Palta, tomate y mayo', precio: 3500, stock: 10, categoria: 'COMIDA' };

  assert.equal((await api('POST', '/api/productos', nuevo, cajero)).estado, 403);

  const creado = await api('POST', '/api/productos', nuevo, admin);
  assert.equal(creado.estado, 201);
  const id = creado.datos.data.id;

  const editado = await api('PUT', `/api/productos/${id}`, { ...nuevo, precio: 3900 }, admin);
  assert.equal(editado.estado, 200);
  assert.equal(db.datos.productos.find((p) => p.ID_PRODUCTO === id).PRECIO, 3900);

  assert.equal((await api('DELETE', `/api/productos/${id}`, null, cajero)).estado, 403);
  assert.equal((await api('DELETE', `/api/productos/${id}`, null, admin)).estado, 200);
  assert.equal((await api('PUT', '/api/productos/9999', nuevo, admin)).estado, 404);
});

test('productos: validaciones (precio, stock, categoría) y nombre repetido', async () => {
  const admin = await entrar('maite', 'Maite1234');

  const malo = await api('POST', '/api/productos', { nombre: 'ab', precio: -5, stock: -1, categoria: 'PLATO' }, admin);
  assert.equal(malo.estado, 400);
  assert.ok(malo.datos.errors.length >= 3);

  const repetido = await api('POST', '/api/productos', { nombre: 'la doble maite', precio: 5000, stock: 1, categoria: 'COMIDA' }, admin);
  assert.equal(repetido.estado, 409);
});

test('productos: un nombre con SQL malicioso se guarda como dato, nunca dentro del SQL', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const peligroso = "x'); DROP TABLE producto;--";

  const r = await api('POST', '/api/productos', { nombre: peligroso, precio: 1000, stock: 1, categoria: 'OTRO' }, admin);
  assert.equal(r.estado, 201);
  assert.ok(db.sqlEjecutado.every((sql) => !sql.includes('DROP TABLE')));
});


/* ---------- Pedidos ---------- */

test('pedidos: el cajero registra un pedido, baja el stock y queda en preparación', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const stockAntes = db.datos.productos.find((p) => p.ID_PRODUCTO === 1).STOCK;

  const r = await api('POST', '/api/pedidos', {
    nombreCliente: 'Camila',
    tipoEntrega: 'Mesa 03',
    notaCocinero: 'pan fresco',
    productos: [{ productoId: 1, cantidad: 2 }, { productoId: 2, cantidad: 1 }, { productoId: 1, cantidad: 1, combo: true }]
  }, cajero);

  assert.equal(r.estado, 201);
  const p = r.datos.data;
  assert.equal(p.estado, 'En preparación');
  assert.equal(p.destino, 'Mesa 03');
  assert.equal(p.nota, 'pan fresco');
  assert.equal(p.cliente, 'Camila');
  assert.equal(p.total, 6990 * 2 + 3990 + (6990 + 2000));            // combo = precio + 2000, calculado por el servidor
  assert.ok(p.items.some((i) => i.nombre === 'La Doble Maite (combo)'));
  assert.equal(db.datos.productos.find((x) => x.ID_PRODUCTO === 1).STOCK, stockAntes - 3);
});

test('pedidos: el precio lo decide el servidor, no el navegador', async () => {
  const cajero = await entrar('camila', 'Cajera2026');

  const r = await api('POST', '/api/pedidos', {
    nombreCliente: 'Hacker', tipoEntrega: 'Para llevar',
    productos: [{ productoId: 2, cantidad: 1, precio: 1 }]
  }, cajero);

  assert.equal(r.estado, 400);           // campos desconocidos se rechazan
});

test('pedidos: validaciones y reglas de stock', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const pedido = (productos, extra = {}) => api('POST', '/api/pedidos', { nombreCliente: 'Juan', tipoEntrega: 'Para llevar', productos, ...extra }, cajero);

  assert.equal((await pedido([])).estado, 400);                                          // sin productos
  assert.equal((await pedido([{ productoId: 1, cantidad: 0 }])).estado, 400);           // cantidad inválida
  assert.equal((await pedido([{ productoId: 1, cantidad: 1 }], { tipoEntrega: 'Mesa 99' })).estado, 400);
  assert.equal((await pedido([{ productoId: 1, cantidad: 1 }], { nombreCliente: '' })).estado, 400);
  assert.equal((await pedido([{ productoId: 999, cantidad: 1 }])).estado, 400);         // producto inexistente
  assert.equal((await pedido([{ productoId: 4, cantidad: 1, combo: true }])).estado, 400); // bebida no es combo

  const agotado = await pedido([{ productoId: 3, cantidad: 1 }]);
  assert.equal(agotado.estado, 409);
  assert.match(agotado.datos.errors[0], /agotado/);

  const demasiado = await pedido([{ productoId: 1, cantidad: 100 }]);
  assert.equal(demasiado.estado, 409);
  assert.match(demasiado.datos.errors[0], /stock suficiente/);
});

test('pedidos: el cocinero no puede registrar pedidos (403)', async () => {
  const cocinero = await entrar('pedro', 'Cocina2026');
  const r = await api('POST', '/api/pedidos', { nombreCliente: 'Ana', tipoEntrega: 'Para llevar', productos: [{ productoId: 2, cantidad: 1 }] }, cocinero);
  assert.equal(r.estado, 403);
});

test('pedidos: el seguimiento respeta los roles (cocinero → listo, cajero → entregado)', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  const creado = await api('POST', '/api/pedidos', { nombreCliente: 'Seguimiento', tipoEntrega: 'Para llevar', productos: [{ productoId: 2, cantidad: 1 }] }, cajero);
  const id = creado.datos.data.numero;

  assert.equal((await api('POST', `/api/pedidos/${id}/avanzar`, null, cajero)).estado, 403);   // el cajero no marca "listo"

  const listo = await api('POST', `/api/pedidos/${id}/avanzar`, null, cocinero);
  assert.equal(listo.estado, 200);
  assert.equal(listo.datos.data.estado, 'Listo para retirar');

  assert.equal((await api('POST', `/api/pedidos/${id}/avanzar`, null, cocinero)).estado, 403); // el cocinero no entrega

  const entregado = await api('POST', `/api/pedidos/${id}/avanzar`, null, cajero);
  assert.equal(entregado.datos.data.estado, 'Entregado');

  const lista = await api('GET', '/api/pedidos', null, cocinero);
  assert.ok(!lista.datos.data.some((p) => p.numero === id));                                   // sale de "En cocina"

  assert.equal((await api('POST', `/api/pedidos/${id}/avanzar`, null, cajero)).estado, 409);
  assert.equal((await api('POST', '/api/pedidos/99999/avanzar', null, cajero)).estado, 404);
});

test('productos: no se elimina un producto que ya está en pedidos (409)', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const r = await api('DELETE', '/api/productos/1', null, admin);
  assert.equal(r.estado, 409);
});


/* ---------- Usuarios ---------- */

test('usuarios: el administrador registra por rol y el nuevo usuario puede entrar', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const nuevo = { nombre: 'Luis Parra', usuario: 'luis', password: 'Luis2026ok', rol: 'cocinero' };

  assert.equal((await api('POST', '/api/usuarios', nuevo, cajero)).estado, 403);
  assert.equal((await api('GET', '/api/usuarios', null, cajero)).estado, 403);

  const r = await api('POST', '/api/usuarios', nuevo, admin);
  assert.equal(r.estado, 201);
  assert.equal(r.datos.data.rol, 'cocinero');

  const login = await api('POST', '/api/auth/login', { usuario: 'luis', password: 'Luis2026ok' });
  assert.equal(login.datos.usuario.rol, 'cocinero');

  const guardado = db.datos.usuarios.find((u) => u.NOMBRE_USUARIO === 'luis');
  assert.ok(!guardado.CONTRASENA_HASH.includes('Luis2026ok'));       // nunca en texto plano
  assert.match(guardado.CONTRASENA_HASH, /^[0-9a-f]+:[0-9a-f]+$/);
  assert.ok(guardado.CONTRASENA_HASH.length <= 255);                 // cabe en CONTRASENA_HASH VARCHAR2(255)
});

test('usuarios: valida datos y rechaza usuario repetido', async () => {
  const admin = await entrar('maite', 'Maite1234');

  const malo = await api('POST', '/api/usuarios', { nombre: 'A', usuario: 'x y', password: '123', rol: 'gerente' }, admin);
  assert.equal(malo.estado, 400);
  assert.ok(malo.datos.errors.length >= 3);

  const repetido = await api('POST', '/api/usuarios', { nombre: 'Otra', usuario: 'MAITE', password: 'Otra12345', rol: 'cajero' }, admin);
  assert.equal(repetido.estado, 409);
});


/* ---------- Errores ---------- */

test('si Oracle no responde, el error es 503 y no se filtran detalles', async () => {
  const dbCaida = {
    ...db,
    ejecutar: async () => { throw Object.assign(new Error('ORA-12541: TNS:no listener (host secreto:1521)'), { errorNum: 12541 }); },
    sesion: async () => { throw new Error('NJS-503: connection to host secreto failed'); }
  };

  const app = crearApp({ db: dbCaida }).listen(0);
  await new Promise((ok) => app.once('listening', ok));

  const respuesta = await fetch(`http://localhost:${app.address().port}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: 'maite', password: 'Maite1234' })
  });
  const datos = await respuesta.json();
  app.close();

  assert.equal(respuesta.status, 503);
  assert.ok(!JSON.stringify(datos).includes('secreto'));
  assert.ok(!JSON.stringify(datos).includes('ORA-'));
});

test('JSON mal formado devuelve 400', async () => {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
  assert.equal(r.status, 400);
});
