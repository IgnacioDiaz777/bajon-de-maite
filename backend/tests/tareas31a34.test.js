/* ==========================================================
   PRUEBAS DE LAS TAREAS 31 A 34  →  npm test
     #31 Alertas en tiempo real · #32 Pasarela de pagos
     #33 Perfiles y direcciones   · #34 Panel de ventas
   Usan la base falsa (tests/dbFalsa.js) y un proveedor de pagos
   falso: comprueban la lógica, NO el SQL ni Webpay real.
   ========================================================== */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const carpetaRespaldos = mkdtempSync(path.join(tmpdir(), 'bajon-t34-'));

process.env.JWT_SECRET = 'clave-solo-para-pruebas-0123456789-abcdefghij';
process.env.LOG_ARCHIVO = '0';
process.env.RESPALDO_DIR = carpetaRespaldos;

const { crearApp } = await import('../app.js');
const { crearDbFalsa } = await import('./dbFalsa.js');
const { validarPagos } = await import('../config/env.js');
const eventos = await import('../services/eventosService.js');
const { crearProveedorSimulado } = await import('../services/pagos/proveedorSimulado.js');
const { crearProveedorTransbank } = await import('../services/pagos/proveedorTransbank.js');
const { conciliarPagos } = await import('../services/pagoService.js');
const { resolverRango } = await import('../services/analiticaService.js');
const { resumenDireccion } = await import('../services/clienteService.js');
const { crearLimitador } = await import('../services/limitador.js');
const { reiniciarLimiteClave } = await import('../services/perfilService.js');
const { reiniciarLimiteEnvios } = await import('../services/feedbackService.js');
const backup = await import('../services/backupService.js');


let db;
let servidor;
let base;
let proveedor;

const configPagos = { proveedor: 'simulado', ambiente: 'integracion', urlPublicaApi: '', urlFrontend: 'http://front.test', minutosExpiracion: 30, produccion: false };
const servidores = [];


function escuchar(app) {
  return new Promise((ok) => {
    const s = app.listen(0, () => { servidores.push(s); ok(s); });
  });
}

before(async () => {
  db = crearDbFalsa();

  db.agregarUsuario('Maite López', 'maite', 'Maite1234', 'administrador');
  db.agregarUsuario('Camila Soto', 'camila', 'Cajera2026', 'cajero');
  db.agregarUsuario('Pedro Cocina', 'pedro', 'Cocina2026', 'cocinero');

  db.agregarProducto('La Doble Maite', 6990, 12, 'COMIDA');     // id 1
  db.agregarProducto('Papas con todo', 3990, 20, 'COMIDA');     // id 2
  db.agregarProducto('Bebidas', 1200, 60, 'BEBIDA');            // id 3

  proveedor = crearProveedorSimulado(configPagos);
  servidor = await escuchar(crearApp({ db, proveedorPagos: proveedor, configPagos }));
  base = `http://localhost:${servidor.address().port}`;
  configPagos.urlPublicaApi = base;
});

after(() => {
  eventos.reiniciarEventos();
  for (const s of servidores) { s.closeAllConnections(); s.close(); }
  rmSync(carpetaRespaldos, { recursive: true, force: true });
});


async function api(metodo, ruta, cuerpo, token, urlBase = base) {
  const r = await fetch(urlBase + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });

  return { estado: r.status, datos: await r.json() };
}

const entrar = async (usuario, password, urlBase = base) => (await api('POST', '/api/auth/login', { usuario, password }, null, urlBase)).datos.token;

async function nuevoPedido(token, extra = {}) {
  const r = await api('POST', '/api/pedidos', { nombreCliente: 'Ana', tipoEntrega: 'Mesa 01', productos: [{ productoId: 2, cantidad: 1 }], ...extra }, token);
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  return r.datos.data;
}

const esperar = async (condicion, ms = 1500) => {
  for (let i = 0; i < ms / 10; i += 1) {
    const valor = condicion();
    if (valor) return valor;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  return undefined;
};

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));


/* ==========================================================
   #31 NOTIFICACIONES Y ALERTAS EN TIEMPO REAL
   ========================================================== */

async function abrirFlujo(token, cabeceras = {}) {
  const control = new AbortController();
  const r = await fetch(`${base}/api/notificaciones/flujo`, { headers: { Authorization: `Bearer ${token}`, ...cabeceras }, signal: control.signal });

  const recibidos = [];
  let terminado = false;

  if (r.status === 200) {
    const lector = r.body.getReader();
    const decodificador = new TextDecoder();
    let memoria = '';

    (async () => {
      try {
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          memoria += decodificador.decode(value, { stream: true });

          let i;
          while ((i = memoria.indexOf('\n\n')) >= 0) {
            const bloque = memoria.slice(0, i);
            memoria = memoria.slice(i + 2);
            const datos = bloque.split('\n').find((l) => l.startsWith('data: '));
            if (datos) recibidos.push(JSON.parse(datos.slice(6)));
          }
        }
      } catch { /* conexión cerrada */ }
      terminado = true;
    })();
  }

  return {
    respuesta: r,
    recibidos,
    cerrada: () => terminado,
    cerrar: () => control.abort(),
    esperar: (tipo, ms) => esperar(() => recibidos.find((a) => a.tipo === tipo), ms)
  };
}

test('alertas: cada aviso es visible solo para los roles que corresponden', () => {
  const aviso = { roles: ['cocinero'], usuarioId: 7 };

  assert.equal(eventos.esVisiblePara(aviso, { rol: 'cocinero', id: 1 }), true);
  assert.equal(eventos.esVisiblePara(aviso, { rol: 'cajero', id: 7 }), true);           // también el usuario puntual
  assert.equal(eventos.esVisiblePara(aviso, { rol: 'cajero', id: 2 }), false);
  assert.equal(eventos.esVisiblePara({}, { rol: 'cajero', id: 2 }), true);              // sin filtro: todos
});

test('alertas: el flujo en tiempo real exige sesión y los avisos recientes se listan por rol', async () => {
  eventos.reiniciarEventos();
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  assert.equal((await fetch(`${base}/api/notificaciones/flujo`)).status, 401);
  assert.equal((await fetch(`${base}/api/notificaciones`)).status, 401);

  await nuevoPedido(cajero);
  await pausa(30);

  const paraCocina = await api('GET', '/api/notificaciones', null, cocinero);
  const paraCaja = await api('GET', '/api/notificaciones', null, cajero);

  assert.ok(paraCocina.datos.data.some((a) => a.tipo === 'pedido_nuevo'));
  assert.ok(!paraCaja.datos.data.some((a) => a.tipo === 'pedido_nuevo'));
  assert.ok(!JSON.stringify(paraCocina.datos).includes('roles'));          // los datos internos no salen
});

test('alertas: un pedido nuevo llega a la cocina al instante y no al cajero', async () => {
  eventos.reiniciarEventos();
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');
  const admin = await entrar('maite', 'Maite1234');

  const cocina = await abrirFlujo(cocinero);
  const caja = await abrirFlujo(cajero);
  const administrador = await abrirFlujo(admin);

  assert.equal(cocina.respuesta.status, 200);
  assert.match(cocina.respuesta.headers.get('content-type'), /text\/event-stream/);

  const pedido = await nuevoPedido(cajero, { nombreCliente: 'Luis', tipoEntrega: 'Mesa 03' });

  const aviso = await cocina.esperar('pedido_nuevo');
  assert.ok(aviso);
  assert.match(aviso.titulo, new RegExp(`#${String(pedido.numero).padStart(3, '0')}`));
  assert.match(aviso.mensaje, /Mesa 03/);
  assert.ok(await administrador.esperar('pedido_nuevo'));

  await pausa(100);
  assert.ok(!caja.recibidos.some((a) => a.tipo === 'pedido_nuevo'));

  [cocina, caja, administrador].forEach((f) => f.cerrar());
});

test('alertas: pedido listo avisa al cajero; el stock bajo, solo al administrador', async () => {
  eventos.reiniciarEventos();
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');
  const admin = await entrar('maite', 'Maite1234');

  const caja = await abrirFlujo(cajero);
  const cocina = await abrirFlujo(cocinero);
  const administrador = await abrirFlujo(admin);

  // 12 - 8 = 4 unidades: queda bajo el umbral (5)
  const pedido = await nuevoPedido(cajero, { productos: [{ productoId: 1, cantidad: 8 }] });

  const stock = await administrador.esperar('stock_bajo');
  assert.ok(stock);
  assert.match(stock.titulo, /La Doble Maite/);
  assert.equal(stock.datos.stock, 4);
  assert.equal(stock.nivel, 'aviso');

  await api('POST', `/api/pedidos/${pedido.numero}/avanzar`, null, cocinero);
  const listo = await caja.esperar('pedido_listo');
  assert.ok(listo);
  assert.equal(listo.nivel, 'exito');

  await pausa(100);
  assert.ok(!cocina.recibidos.some((a) => a.tipo === 'pedido_listo' || a.tipo === 'stock_bajo'));
  assert.ok(!caja.recibidos.some((a) => a.tipo === 'stock_bajo'));

  // Agotar el producto genera una alerta distinta
  await nuevoPedido(cajero, { productos: [{ productoId: 1, cantidad: 4 }] });
  const agotado = await administrador.esperar('stock_agotado');
  assert.ok(agotado);
  assert.equal(agotado.nivel, 'alerta');

  [caja, cocina, administrador].forEach((f) => f.cerrar());
});

test('alertas: al reconectar se reenvía lo que se perdió (Last-Event-ID) y se limitan las conexiones por usuario', async () => {
  eventos.reiniciarEventos();
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  const primera = await abrirFlujo(cocinero);
  await nuevoPedido(cajero);
  const visto = await primera.esperar('pedido_nuevo');
  primera.cerrar();

  await nuevoPedido(cajero, { nombreCliente: 'Mientras tanto' });         // llega con el navegador desconectado
  await pausa(30);

  const segunda = await abrirFlujo(cocinero, { 'Last-Event-ID': String(visto.id) });
  const perdido = await segunda.esperar('pedido_nuevo');
  assert.ok(perdido);
  assert.ok(perdido.id > visto.id);
  assert.match(perdido.mensaje, /Mientras tanto/);
  assert.equal(segunda.recibidos.filter((a) => a.id <= visto.id).length, 0);   // lo ya visto no se repite
  segunda.cerrar();

  // Máximo 3 conexiones por usuario: al abrir la cuarta se cierra la más antigua
  const abiertas = [];
  for (let i = 0; i < 4; i += 1) abiertas.push(await abrirFlujo(cocinero));
  assert.ok(await esperar(() => abiertas[0].cerrada()));
  assert.equal(abiertas[3].cerrada(), false);
  assert.equal(eventos.totalConectados(), 3);
  abiertas.forEach((f) => f.cerrar());
});

test('alertas: un fallo grave reportado avisa al administrador (los leves no)', async () => {
  eventos.reiniciarEventos();
  reiniciarLimiteEnvios();
  const cocinero = await entrar('pedro', 'Cocina2026');
  const admin = await entrar('maite', 'Maite1234');
  const administrador = await abrirFlujo(admin);

  await api('POST', '/api/feedback', { tipo: 'FALLO', gravedad: 'BAJA', titulo: 'Detalle visual', descripcion: 'Un botón se ve chico' }, cocinero);
  await api('POST', '/api/feedback', { tipo: 'FALLO', gravedad: 'ALTA', titulo: 'No abre la cocina', descripcion: 'No puedo ver los pedidos' }, cocinero);

  const aviso = await administrador.esperar('fallo_reportado');
  assert.ok(aviso);
  assert.match(aviso.mensaje, /No abre la cocina/);
  assert.equal(administrador.recibidos.filter((a) => a.tipo === 'fallo_reportado').length, 1);
  administrador.cerrar();
});

test('alertas: la conexión larga que el servidor cierra no cuenta como solicitud lenta en el monitoreo', async () => {
  const admin = await entrar('maite', 'Maite1234');
  await api('POST', '/api/monitoreo/reiniciar', null, admin);

  // Al abrir la cuarta conexión del mismo usuario el servidor cierra la primera (termina su respuesta)
  const abiertas = [];
  for (let i = 0; i < 4; i += 1) abiertas.push(await abrirFlujo(admin));
  assert.ok(await esperar(() => abiertas[0].cerrada()));
  abiertas.forEach((f) => f.cerrar());

  const monitoreo = await api('GET', '/api/monitoreo', null, admin);
  assert.ok(!monitoreo.datos.data.rutas.some((r) => r.ruta.includes('/flujo')));
});


/* ==========================================================
   #33 PERFILES Y DIRECCIONES DE DESPACHO
   ========================================================== */

const direccion = { alias: 'Casa', calle: 'Av. Providencia', numero: '1234', depto: '56', comuna: 'Providencia', referencia: 'Portón negro' };

test('clientes: crear, validar, buscar, ver y editar un perfil', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  const creado = await api('POST', '/api/clientes', { nombre: 'Ana Pérez', telefono: '+56 9 1234 5678', email: 'ana@correo.cl', notas: 'Sin cebolla' }, cajero);
  assert.equal(creado.estado, 201);
  assert.equal(creado.datos.data.telefono, '+56 9 1234 5678');
  const id = creado.datos.data.id;

  // Validaciones
  assert.equal((await api('POST', '/api/clientes', { nombre: '' }, cajero)).estado, 400);
  assert.equal((await api('POST', '/api/clientes', { nombre: 'Otro', telefono: 'hola' }, cajero)).estado, 400);
  assert.equal((await api('POST', '/api/clientes', { nombre: 'Otro', email: 'no-es-correo' }, cajero)).estado, 400);
  assert.equal((await api('POST', '/api/clientes', { nombre: 'Otro', rol: 'administrador' }, cajero)).estado, 400);   // campos desconocidos

  // Nombre repetido (sin importar mayúsculas)
  assert.equal((await api('POST', '/api/clientes', { nombre: 'ana pérez' }, cajero)).estado, 409);

  await api('POST', '/api/clientes', { nombre: 'Beto Soto', telefono: '987654321' }, cajero);

  // Buscar por nombre o por teléfono; los comodines del usuario no funcionan como comodines
  const porNombre = await api('GET', '/api/clientes?buscar=PÉREZ', null, cajero);
  assert.deepEqual(porNombre.datos.data.map((c) => c.nombre), ['Ana Pérez']);
  assert.equal((await api('GET', '/api/clientes?buscar=%25', null, cajero)).datos.data.length, 0);       // "%" no es comodín

  const porTelefono = await api('GET', '/api/clientes?buscar=9876', null, cajero);
  assert.deepEqual(porTelefono.datos.data.map((c) => c.nombre), ['Beto Soto']);

  const nombres = (await api('GET', '/api/clientes', null, cajero)).datos.data.map((c) => c.nombre);
  assert.ok(nombres.includes('Ana Pérez') && nombres.includes('Beto Soto'));
  assert.deepEqual(nombres, [...nombres].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));        // en orden alfabético

  // Editar
  const editado = await api('PUT', `/api/clientes/${id}`, { nombre: 'Ana P. Pérez', telefono: '911112222', notas: '' }, cajero);
  assert.equal(editado.estado, 200);
  assert.equal(editado.datos.data.nombre, 'Ana P. Pérez');
  assert.equal(editado.datos.data.email, '');
  assert.equal((await api('PUT', `/api/clientes/${id}`, { nombre: 'Beto Soto' }, cajero)).estado, 409);

  assert.equal((await api('GET', '/api/clientes/99999', null, cajero)).estado, 404);
  assert.equal((await api('GET', '/api/clientes/abc', null, cajero)).estado, 400);

  // Permisos: el cocinero no gestiona clientes
  assert.equal((await api('GET', '/api/clientes', null, cocinero)).estado, 403);
  assert.equal((await api('POST', '/api/clientes', { nombre: 'Intruso' }, cocinero)).estado, 403);
  assert.equal((await api('GET', '/api/clientes')).estado, 401);
});

test('clientes: solo el administrador elimina; el cliente eliminado desaparece de las búsquedas', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const { datos } = await api('POST', '/api/clientes', { nombre: 'Para Borrar' }, cajero);

  assert.equal((await api('DELETE', `/api/clientes/${datos.data.id}`, null, cajero)).estado, 403);
  assert.equal((await api('DELETE', `/api/clientes/${datos.data.id}`, null, admin)).estado, 200);
  assert.equal((await api('GET', `/api/clientes/${datos.data.id}`, null, admin)).estado, 404);
  assert.ok(!(await api('GET', '/api/clientes?buscar=Borrar', null, admin)).datos.data.length);
  assert.equal((await api('DELETE', `/api/clientes/${datos.data.id}`, null, admin)).estado, 404);
});

test('direcciones: la primera es la principal, solo hay una principal, máximo 5 y validación', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const { datos } = await api('POST', '/api/clientes', { nombre: 'Con Direcciones' }, cajero);
  const id = datos.data.id;

  const primera = await api('POST', `/api/clientes/${id}/direcciones`, direccion, cajero);
  assert.equal(primera.estado, 201);
  assert.equal(primera.datos.data.esPrincipal, true);
  assert.equal(primera.datos.data.ciudad, 'Santiago');

  const segunda = await api('POST', `/api/clientes/${id}/direcciones`, { ...direccion, alias: 'Trabajo', calle: 'Alameda', numero: '100', esPrincipal: true }, cajero);
  assert.equal(segunda.datos.data.esPrincipal, true);

  const vista = (await api('GET', `/api/clientes/${id}`, null, cajero)).datos.data.direcciones;
  assert.equal(vista.filter((d) => d.esPrincipal).length, 1);
  assert.equal(vista[0].alias, 'Trabajo');                                     // la principal aparece primero

  // Validaciones
  assert.equal((await api('POST', `/api/clientes/${id}/direcciones`, { alias: 'X' }, cajero)).estado, 400);
  assert.equal((await api('POST', `/api/clientes/${id}/direcciones`, { ...direccion, comuna: '' }, cajero)).estado, 400);
  assert.equal((await api('POST', '/api/clientes/99999/direcciones', direccion, cajero)).estado, 404);

  // Eliminar la principal: otra pasa a serlo
  const idTrabajo = segunda.datos.data.id;
  assert.equal((await api('DELETE', `/api/clientes/${id}/direcciones/${idTrabajo}`, null, cajero)).estado, 200);
  const despues = (await api('GET', `/api/clientes/${id}`, null, cajero)).datos.data.direcciones;
  assert.equal(despues.length, 1);
  assert.equal(despues[0].esPrincipal, true);

  // Editar
  const editada = await api('PUT', `/api/clientes/${id}/direcciones/${despues[0].id}`, { ...direccion, calle: 'Los Leones', numero: '50' }, cajero);
  assert.equal(editada.datos.data.calle, 'Los Leones');

  // Una dirección de otro cliente no se puede tocar con la ruta de este
  const otro = (await api('POST', '/api/clientes', { nombre: 'Otro Cliente' }, cajero)).datos.data.id;
  assert.equal((await api('PUT', `/api/clientes/${otro}/direcciones/${despues[0].id}`, direccion, cajero)).estado, 404);
  assert.equal((await api('DELETE', `/api/clientes/${otro}/direcciones/${despues[0].id}`, null, cajero)).estado, 404);

  // Máximo 5 direcciones
  for (let i = 0; i < 4; i += 1) assert.equal((await api('POST', `/api/clientes/${id}/direcciones`, { ...direccion, alias: `Extra ${i}` }, cajero)).estado, 201);
  assert.equal((await api('POST', `/api/clientes/${id}/direcciones`, direccion, cajero)).estado, 409);
});

test('despacho: el pedido exige cliente y dirección propia; guarda el destino y usa el nombre de la base', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const admin = await entrar('maite', 'Maite1234');

  const cliente = (await api('POST', '/api/clientes', { nombre: 'Clienta Despacho', telefono: '955554444' }, cajero)).datos.data;
  const dir = (await api('POST', `/api/clientes/${cliente.id}/direcciones`, { ...direccion, calle: 'Calle [Rara]' }, cajero)).datos.data;
  const ajeno = (await api('POST', '/api/clientes', { nombre: 'Clienta Ajena' }, cajero)).datos.data;
  const dirAjena = (await api('POST', `/api/clientes/${ajeno.id}/direcciones`, direccion, cajero)).datos.data;

  const productos = [{ productoId: 3, cantidad: 2 }];
  const pedido = (extra) => api('POST', '/api/pedidos', { nombreCliente: 'Nombre escrito a mano', tipoEntrega: 'Despacho', productos, ...extra }, cajero);

  // Sin cliente, sin dirección, dirección ajena o inexistente
  assert.equal((await pedido({})).estado, 400);
  assert.equal((await pedido({ idCliente: cliente.id })).estado, 400);
  assert.equal((await pedido({ idCliente: cliente.id, idDireccion: dirAjena.id })).estado, 400);
  assert.equal((await pedido({ idCliente: cliente.id, idDireccion: 99999 })).estado, 400);
  assert.equal((await pedido({ idCliente: 99999, idDireccion: dir.id })).estado, 400);

  // La dirección solo se usa con despacho
  assert.equal((await api('POST', '/api/pedidos', { nombreCliente: 'Ana', tipoEntrega: 'Mesa 01', idDireccion: dir.id, productos }, cajero)).estado, 400);

  // Correcto
  const ok = await pedido({ idCliente: cliente.id, idDireccion: dir.id, notaCocinero: 'Tocar timbre' });
  assert.equal(ok.estado, 201, JSON.stringify(ok.datos));
  assert.equal(ok.datos.data.cliente, 'Clienta Despacho');                         // el nombre viene de la base de datos
  assert.equal(ok.datos.data.destino, 'Despacho: Calle Rara 1234, depto 56, Providencia');   // sin corchetes en el texto
  assert.equal(ok.datos.data.nota, 'Tocar timbre');

  const lista = (await api('GET', '/api/pedidos', null, admin)).datos.data;
  assert.equal(lista.find((p) => p.numero === ok.datos.data.numero).destino.startsWith('Despacho: '), true);

  // Un cliente eliminado ya no se puede usar
  await api('DELETE', `/api/clientes/${cliente.id}`, null, admin);
  assert.equal((await pedido({ idCliente: cliente.id, idDireccion: dir.id })).estado, 400);

  // El flujo de siempre (cliente por nombre) sigue funcionando
  assert.equal((await api('POST', '/api/pedidos', { nombreCliente: 'Cliente Nuevo Por Nombre', tipoEntrega: 'Para llevar', productos }, cajero)).estado, 201);
});

test('despacho: resumen de dirección sin corchetes ni espacios repetidos', () => {
  assert.equal(resumenDireccion({ calle: 'Av.  Italia', numero: '[10]', depto: '', comuna: 'Ñuñoa' }), 'Av. Italia 10, Ñuñoa');
});

test('perfil: ver y cambiar el propio nombre (devuelve un token al día)', async () => {
  const cocinero = await entrar('pedro', 'Cocina2026');

  const yo = await api('GET', '/api/perfil', null, cocinero);
  assert.equal(yo.datos.data.usuario, 'pedro');
  assert.equal((await api('GET', '/api/perfil')).estado, 401);

  assert.equal((await api('PUT', '/api/perfil', { nombre: '' }, cocinero)).estado, 400);
  assert.equal((await api('PUT', '/api/perfil', { nombre: 'Pedro Cocinero', rol: 'administrador' }, cocinero)).estado, 400);

  const r = await api('PUT', '/api/perfil', { nombre: 'Pedro Cocinero Jefe' }, cocinero);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.data.iniciales, 'PC');
  assert.equal(r.datos.data.rol, 'cocinero');                                   // el rol no cambia

  const conTokenNuevo = await api('GET', '/api/perfil', null, r.datos.token);
  assert.equal(conTokenNuevo.datos.data.nombre, 'Pedro Cocinero Jefe');
  assert.equal(db.datos.usuarios.find((u) => u.NOMBRE_USUARIO === 'pedro').NOMBRE, 'Pedro Cocinero Jefe');
});

test('perfil: cambiar la contraseña exige la actual, valida la nueva, limita los intentos y no se audita', async () => {
  reiniciarLimiteClave();
  const cajero = await entrar('camila', 'Cajera2026');

  assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: 'Cajera2026', claveNueva: 'corta1' }, cajero)).estado, 400);
  assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: 'Cajera2026', claveNueva: 'solo letras largas' }, cajero)).estado, 400);
  assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: 'Cajera2026', claveNueva: 'Cajera2026' }, cajero)).estado, 400);
  assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: 'Equivocada9', claveNueva: 'NuevaClave2027' }, cajero)).estado, 400);

  const ok = await api('PUT', '/api/perfil/clave', { claveActual: 'Cajera2026', claveNueva: 'NuevaClave2027' }, cajero);
  assert.equal(ok.estado, 200);

  assert.equal((await api('POST', '/api/auth/login', { usuario: 'camila', password: 'Cajera2026' })).estado, 401);
  assert.equal((await api('POST', '/api/auth/login', { usuario: 'camila', password: 'NuevaClave2027' })).estado, 200);

  await esperar(() => db.datos.auditoria.find((a) => a.ACCION === 'CLAVE_CAMBIAR' && a.RESULTADO === 'EXITO'));
  const auditoria = JSON.stringify(db.datos.auditoria);
  assert.ok(auditoria.includes('CLAVE_CAMBIAR'));
  for (const secreto of ['Cajera2026', 'NuevaClave2027', 'Equivocada9']) assert.ok(!auditoria.includes(secreto), secreto);

  // Fuerza bruta con una sesión robada: después de 5 fallos se bloquea (aunque luego acierte)
  const token = await entrar('camila', 'NuevaClave2027');
  for (let i = 0; i < 5; i += 1) assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: `Mala${i}Mala${i}`, claveNueva: 'OtraClave2028' }, token)).estado, 400);
  assert.equal((await api('PUT', '/api/perfil/clave', { claveActual: 'NuevaClave2027', claveNueva: 'OtraClave2028' }, token)).estado, 429);

  reiniciarLimiteClave();
  db.datos.usuarios.find((u) => u.NOMBRE_USUARIO === 'camila').CONTRASENA_HASH = (await import('../services/authService.js')).hashearClave('Cajera2026');
});

test('limitador: cuenta fallos dentro de la ventana y los olvida después', () => {
  let ahora = 1000;
  const limitador = crearLimitador({ max: 2, ventanaMs: 1000, ahora: () => ahora });

  limitador.revisar('a');
  limitador.registrar('a');
  limitador.registrar('a');
  assert.throws(() => limitador.revisar('a'), (e) => e.estado === 429);
  assert.doesNotThrow(() => limitador.revisar('b'));          // otra clave no se ve afectada

  ahora += 1500;                                              // pasó la ventana
  assert.doesNotThrow(() => limitador.revisar('a'));
});


/* ==========================================================
   #32 PASARELA DE PAGOS
   ========================================================== */

// Simula lo que hace el navegador: elegir en la pantalla de pago y volver a la app
async function pagarEnSimulador(token, decision) {
  const resolver = await fetch(`${base}/api/pagos/simulador/resolver`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token_ws: token, decision })
  });

  assert.equal(resolver.status, 303);
  const retorno = await fetch(resolver.headers.get('location'), { redirect: 'manual' });
  assert.equal(retorno.status, 303);

  return new URL(retorno.headers.get('location'));
}

const estadoPago = (id) => db.datos.pagos.find((p) => p.ID_PAGO === id);

test('pagos: efectivo con vuelto, sin doble cobro, con permisos y validaciones', async () => {
  db.datos.productos.forEach((p) => { p.STOCK = 1000; });          // los tests anteriores gastaron stock
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');
  const pedido = await nuevoPedido(cajero);                       // $3.990

  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cocinero)).estado, 403);
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero })).estado, 401);
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: 99999 }, cajero)).estado, 404);
  assert.equal((await api('POST', '/api/pagos/efectivo', {}, cajero)).estado, 400);
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero, monto: 1 }, cajero)).estado, 400);   // el monto nunca viene del navegador
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero, recibido: 1000 }, cajero)).estado, 400);

  const ok = await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero, recibido: 5000 }, cajero);
  assert.equal(ok.estado, 201);
  assert.equal(ok.datos.data.monto, 3990);
  assert.equal(ok.datos.data.vuelto, 1010);
  assert.equal(ok.datos.data.estado, 'AUTORIZADO');

  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero)).estado, 409);      // ya pagado
  assert.equal((await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero)).estado, 409);

  // Un pedido cancelado no se cobra
  const cancelado = await nuevoPedido(cajero);
  db.datos.pedidos.find((p) => p.ID_PEDIDO === cancelado.numero).ESTADO = 'CANCELADO';
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: cancelado.numero }, cajero)).estado, 409);

  await esperar(() => db.datos.auditoria.find((a) => a.ACCION === 'PAGO_EFECTIVO' && a.ID_ENTIDAD === String(pedido.numero)));
  assert.ok(db.datos.auditoria.some((a) => a.ACCION === 'PAGO_EFECTIVO' && a.RESULTADO === 'EXITO' && a.USUARIO === 'camila'));
});

test('pagos con tarjeta: el monto sale del pedido, se confirma una sola vez y el resultado vuelve a la app', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const pedido = await nuevoPedido(cajero, { productos: [{ productoId: 1, cantidad: 1 }, { productoId: 3, cantidad: 2 }] });   // 6990 + 2400

  assert.equal((await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero, monto: 10 }, cajero)).estado, 400);

  const inicio = await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero);
  assert.equal(inicio.estado, 201);
  assert.equal(inicio.datos.data.monto, 9390);
  assert.equal(inicio.datos.data.url, `${base}/api/pagos/simulador`);
  assert.equal(estadoPago(inicio.datos.data.idPago).ESTADO, 'CREADO');
  assert.ok(estadoPago(inicio.datos.data.idPago).BUY_ORDER.length <= 26);

  // La pantalla de pago simulada se muestra y escapa lo que recibe
  const pagina = await fetch(`${base}/api/pagos/simulador?token_ws=${inicio.datos.data.token}`);
  assert.match(await pagina.text(), /Aprobar pago/);

  const vuelta = await pagarEnSimulador(inicio.datos.data.token, 'aprobar');
  assert.equal(vuelta.origin, 'http://front.test');
  assert.equal(vuelta.hash, `#/pedidos?pago=autorizado&pedido=${pedido.numero}`);

  const pago = estadoPago(inicio.datos.data.idPago);
  assert.equal(pago.ESTADO, 'AUTORIZADO');
  assert.equal(pago.ULTIMOS4, '6623');                           // solo los últimos 4 dígitos
  assert.equal(pago.CODIGO_RESPUESTA, 0);
  assert.ok(!JSON.stringify(pago).match(/\d{13,}/));              // ningún número largo de tarjeta

  // Volver otra vez (recargar la página, doble clic): no se cobra de nuevo y se muestra el mismo resultado
  const otra = await fetch(`${base}/api/pagos/retorno?token_ws=${inicio.datos.data.token}`, { redirect: 'manual' });
  assert.match(otra.headers.get('location'), /pago=autorizado/);
  assert.equal(db.datos.pagos.filter((p) => p.ID_PEDIDO === pedido.numero && p.ESTADO === 'AUTORIZADO').length, 1);
});

test('pagos con tarjeta: pago rechazado, cancelado, intentos repetidos y tokens inventados', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const pedido = await nuevoPedido(cajero);

  const intento = async () => (await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero)).datos.data;

  // Rechazado: el pedido sigue sin pagar y se puede reintentar
  const a = await intento();
  assert.equal((await pagarEnSimulador(a.token, 'rechazar')).hash, `#/pedidos?pago=rechazado&pedido=${pedido.numero}`);
  assert.equal(estadoPago(a.idPago).ESTADO, 'RECHAZADO');

  // Cancelado por el cliente
  const b = await intento();
  assert.match((await pagarEnSimulador(b.token, 'cancelar')).hash, /pago=cancelado/);
  assert.equal(estadoPago(b.idPago).ESTADO, 'ABANDONADO');

  // Un intento nuevo deja abandonado al anterior que nadie terminó…
  const c = await intento();
  const d = await intento();
  assert.equal(estadoPago(c.idPago).ESTADO, 'ABANDONADO');
  assert.equal(estadoPago(d.idPago).ESTADO, 'CREADO');

  // …y si el cliente igual completa el viejo, NO se confirma (la pasarela lo reversa sola)
  proveedor.decidir(c.token, 'aprobar');
  const viejo = await fetch(`${base}/api/pagos/retorno?token_ws=${c.token}`, { redirect: 'manual' });
  assert.match(viejo.headers.get('location'), /pago=cancelado/);
  assert.equal(estadoPago(c.idPago).ESTADO, 'ABANDONADO');
  assert.equal(db.datos.pagos.filter((p) => p.ID_PEDIDO === pedido.numero && p.ESTADO === 'AUTORIZADO').length, 0);

  // Tokens que no existen o con formato raro
  for (const token of ['SIMinventado123456', 'x', "'; DROP TABLE pago; --", 'a'.repeat(500)]) {
    const r = await fetch(`${base}/api/pagos/retorno?token_ws=${encodeURIComponent(token)}`, { redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /pago=desconocido/);
  }
  const sinNada = await fetch(`${base}/api/pagos/retorno`, { redirect: 'manual' });
  assert.match(sinNada.headers.get('location'), /pago=desconocido/);

  // El intento vigente se completa bien
  assert.match((await pagarEnSimulador(d.token, 'aprobar')).hash, /pago=autorizado/);
});

test('pagos con tarjeta: un pago que se completa fuera de tiempo se rechaza', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const pedido = await nuevoPedido(cajero);
  const inicio = (await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero)).datos.data;

  estadoPago(inicio.idPago).FECHA_CREACION = new Date(Date.now() - 31 * 60000);

  assert.match((await pagarEnSimulador(inicio.token, 'aprobar')).hash, /pago=rechazado/);
  assert.equal(estadoPago(inicio.idPago).ESTADO, 'EXPIRADO');
});

test('pagos con tarjeta: si la pasarela cobra un monto distinto, se reembolsa y no se da por pagado', async () => {
  const reembolsos = [];
  const proveedorMalo = {
    nombre: 'simulado',
    crear: async ({ monto }) => ({ token: `MALO${monto}ABCDEFGHIJ`, url: 'http://pasarela.test' }),
    confirmar: async (token) => ({ aprobado: true, estadoPasarela: 'AUTHORIZED', codigoRespuesta: 0, monto: 1, buyOrder: 'otro' , token }),
    reembolsar: async (token, monto) => { reembolsos.push({ token, monto }); return { ok: true }; }
  };

  const app = await escuchar(crearApp({ db, proveedorPagos: proveedorMalo, configPagos }));
  const urlBase = `http://localhost:${app.address().port}`;
  const cajero = await entrar('camila', 'Cajera2026', urlBase);
  const pedido = await nuevoPedido(cajero);

  const inicio = (await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero, urlBase)).datos.data;
  const vuelta = await fetch(`${urlBase}/api/pagos/retorno?token_ws=${inicio.token}`, { redirect: 'manual' });

  assert.match(vuelta.headers.get('location'), /pago=rechazado/);
  assert.equal(estadoPago(inicio.idPago).ESTADO, 'RECHAZADO');
  assert.match(estadoPago(inicio.idPago).DETALLE, /no coincide/);
  assert.deepEqual(reembolsos, [{ token: inicio.token, monto: 1 }]);
});

test('pagos con tarjeta: si el pedido se pagó en efectivo mientras tanto, la tarjeta se reembolsa (no se cobra dos veces)', async () => {
  const reembolsos = [];
  const proveedorLento = {
    nombre: 'simulado',
    crear: async () => ({ token: 'CARRERAABCDEFGHIJ12', url: 'http://pasarela.test' }),
    confirmar: async () => ({ aprobado: true, estadoPasarela: 'AUTHORIZED', codigoRespuesta: 0, monto: 3990, ultimos4: '1111' }),
    reembolsar: async (token, monto) => { reembolsos.push({ token, monto }); return { ok: true }; }
  };

  const app = await escuchar(crearApp({ db, proveedorPagos: proveedorLento, configPagos }));
  const urlBase = `http://localhost:${app.address().port}`;
  const cajero = await entrar('camila', 'Cajera2026', urlBase);
  const pedido = await nuevoPedido(cajero);

  const inicio = (await api('POST', '/api/pagos/tarjeta', { idPedido: pedido.numero }, cajero, urlBase)).datos.data;
  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero, urlBase)).estado, 201);

  const vuelta = await fetch(`${urlBase}/api/pagos/retorno?token_ws=${inicio.token}`, { redirect: 'manual' });

  assert.match(vuelta.headers.get('location'), /pago=rechazado/);
  assert.equal(estadoPago(inicio.idPago).ESTADO, 'RECHAZADO');
  assert.deepEqual(reembolsos, [{ token: 'CARRERAABCDEFGHIJ12', monto: 3990 }]);
  assert.equal(db.datos.pagos.filter((p) => p.ID_PEDIDO === pedido.numero && p.ESTADO === 'AUTORIZADO').length, 1);
});

test('pagos: la conciliación vence los intentos viejos y resuelve los que quedaron a medias', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const consultas = [];
  const proveedorConsulta = {
    nombre: 'simulado',
    estado: async (token) => { consultas.push(token); return { aprobado: true, estadoPasarela: 'AUTHORIZED', codigoRespuesta: 0, monto: 3990, ultimos4: '9999' }; },
    reembolsar: async () => ({ ok: true })
  };

  const pedidoA = await nuevoPedido(cajero);
  const pedidoB = await nuevoPedido(cajero);
  const abandonado = (await api('POST', '/api/pagos/tarjeta', { idPedido: pedidoA.numero }, cajero)).datos.data;
  const atascado = (await api('POST', '/api/pagos/tarjeta', { idPedido: pedidoB.numero }, cajero)).datos.data;

  estadoPago(abandonado.idPago).FECHA_CREACION = new Date(Date.now() - 40 * 60000);
  Object.assign(estadoPago(atascado.idPago), { ESTADO: 'CONFIRMANDO', FECHA_ACTUALIZACION: new Date(Date.now() - 10 * 60000) });

  await conciliarPagos(db, proveedorConsulta, configPagos);

  assert.equal(estadoPago(abandonado.idPago).ESTADO, 'EXPIRADO');
  assert.equal(estadoPago(atascado.idPago).ESTADO, 'AUTORIZADO');               // Transbank sí había cobrado
  assert.equal(estadoPago(atascado.idPago).ULTIMOS4, '9999');
  assert.deepEqual(consultas, [atascado.token]);
});

test('pagos: anular (solo administrador), una sola vez, y el pedido se puede volver a cobrar', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const pedido = await nuevoPedido(cajero);
  const pago = (await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero)).datos.data;

  assert.equal((await api('POST', `/api/pagos/${pago.id}/anular`, null, cajero)).estado, 403);
  assert.equal((await api('POST', '/api/pagos/abc/anular', null, admin)).estado, 400);
  assert.equal((await api('POST', '/api/pagos/99999/anular', null, admin)).estado, 404);

  const anulado = await api('POST', `/api/pagos/${pago.id}/anular`, null, admin);
  assert.equal(anulado.estado, 200);
  assert.equal(estadoPago(pago.id).ESTADO, 'ANULADO');
  assert.equal(estadoPago(pago.id).MONTO_REEMBOLSADO, 3990);
  assert.equal((await api('POST', `/api/pagos/${pago.id}/anular`, null, admin)).estado, 409);

  assert.equal((await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero)).estado, 201);

  // Con tarjeta se pide el reembolso a la pasarela con el token y el monto del pago
  const reembolsos = [];
  const proveedorConReembolso = { nombre: 'simulado', crear: async () => ({ token: 'REEMBOLSOABCDEFGH12', url: 'x' }), confirmar: async () => ({ aprobado: true, monto: 3990, codigoRespuesta: 0 }), reembolsar: async (t, m) => { reembolsos.push([t, m]); return { ok: true, tipo: 'REVERSED' }; } };
  const app = await escuchar(crearApp({ db, proveedorPagos: proveedorConReembolso, configPagos }));
  const urlBase = `http://localhost:${app.address().port}`;
  const admin2 = await entrar('maite', 'Maite1234', urlBase);
  const cajero2 = await entrar('camila', 'Cajera2026', urlBase);

  const otro = await nuevoPedido(cajero2);
  const tarjeta = (await api('POST', '/api/pagos/tarjeta', { idPedido: otro.numero }, cajero2, urlBase)).datos.data;
  await fetch(`${urlBase}/api/pagos/retorno?token_ws=${tarjeta.token}`, { redirect: 'manual' });
  assert.equal(estadoPago(tarjeta.idPago).ESTADO, 'AUTORIZADO');

  assert.equal((await api('POST', `/api/pagos/${tarjeta.idPago}/anular`, null, admin2, urlBase)).estado, 200);
  assert.deepEqual(reembolsos, [['REEMBOLSOABCDEFGH12', 3990]]);
});

test('pagos: estado por pedido e historial (solo administrador)', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');
  const pedido = await nuevoPedido(cajero);
  await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero);
  const sinPagar = await nuevoPedido(cajero);

  const estados = await api('GET', `/api/pagos?pedidos=${pedido.numero},${sinPagar.numero}`, null, cajero);
  assert.deepEqual(estados.datos.data.map((e) => [e.idPedido, e.estado]), [[pedido.numero, 'AUTORIZADO']]);

  assert.equal((await api('GET', '/api/pagos?pedidos=1', null, cocinero)).estado, 403);
  assert.equal((await api('GET', '/api/pagos?pedidos=1;DROP', null, cajero)).estado, 400);
  assert.equal((await api('GET', '/api/pagos', null, cajero)).estado, 400);

  assert.equal((await api('GET', '/api/pagos/historial', null, cajero)).estado, 403);
  const historial = await api('GET', '/api/pagos/historial?estado=AUTORIZADO', null, admin);
  assert.ok(historial.datos.data.length >= 1 && historial.datos.data.every((p) => p.estado === 'AUTORIZADO'));
  assert.ok(!JSON.stringify(historial.datos).includes('token'));                       // el token de la pasarela nunca sale
  assert.equal((await api('GET', '/api/pagos/historial?estado=NADA', null, admin)).estado, 400);
});

test('pagos: con Webpay real no existe la pantalla de pago simulada', async () => {
  const transbank = crearProveedorTransbank({ ambiente: 'integracion', codigoComercio: '597055555532', llaveSecreta: 'x' }, async () => { throw new Error('sin red'); });
  const app = await escuchar(crearApp({ db, proveedorPagos: transbank, configPagos: { ...configPagos, proveedor: 'transbank' } }));
  const urlBase = `http://localhost:${app.address().port}`;

  assert.equal((await fetch(`${urlBase}/api/pagos/simulador`)).status, 404);
  assert.equal((await fetch(`${urlBase}/api/pagos/simulador/resolver`, { method: 'POST' })).status, 404);
});

test('webpay: llama a la API correcta con las cabeceras, entiende las respuestas y no filtra errores internos', async () => {
  const llamadas = [];
  let respuesta = { ok: true, status: 200, cuerpo: {} };

  const fetchFalso = async (url, opciones) => {
    llamadas.push({ url, metodo: opciones.method, cabeceras: opciones.headers, cuerpo: opciones.body && JSON.parse(opciones.body) });
    return { ok: respuesta.ok, status: respuesta.status, text: async () => JSON.stringify(respuesta.cuerpo) };
  };

  const prueba = crearProveedorTransbank({ ambiente: 'integracion', codigoComercio: 'COMERCIO', llaveSecreta: 'SECRETA' }, fetchFalso);
  const raiz = 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions';

  respuesta = { ok: true, status: 200, cuerpo: { token: 'TOKEN1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' } };
  const creada = await prueba.crear({ buyOrder: 'BM1', sessionId: 'U1', monto: 5000, urlRetorno: 'https://miapp.cl/api/pagos/retorno' });
  assert.deepEqual(creada, { token: 'TOKEN1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' });
  assert.equal(llamadas[0].url, raiz);
  assert.equal(llamadas[0].metodo, 'POST');
  assert.equal(llamadas[0].cabeceras['Tbk-Api-Key-Id'], 'COMERCIO');
  assert.equal(llamadas[0].cabeceras['Tbk-Api-Key-Secret'], 'SECRETA');
  assert.deepEqual(llamadas[0].cuerpo, { buy_order: 'BM1', session_id: 'U1', amount: 5000, return_url: 'https://miapp.cl/api/pagos/retorno' });

  respuesta = { ok: true, status: 200, cuerpo: { status: 'AUTHORIZED', response_code: 0, amount: 5000, buy_order: 'BM1', authorization_code: '1213', payment_type_code: 'VN', installments_number: 0, card_detail: { card_number: '6623' } } };
  const aprobada = await prueba.confirmar('TOKEN1');
  assert.equal(llamadas[1].url, `${raiz}/TOKEN1`);
  assert.equal(llamadas[1].metodo, 'PUT');
  assert.deepEqual([aprobada.aprobado, aprobada.ultimos4, aprobada.monto, aprobada.codigoAutorizacion], [true, '6623', 5000, '1213']);

  // Respuesta "FAILED" o con código distinto de 0: no está aprobada
  respuesta = { ok: true, status: 200, cuerpo: { status: 'FAILED', response_code: -1, amount: 5000 } };
  assert.equal((await prueba.confirmar('TOKEN1')).aprobado, false);
  respuesta = { ok: true, status: 200, cuerpo: { status: 'AUTHORIZED', response_code: -2, amount: 5000 } };
  assert.equal((await prueba.confirmar('TOKEN1')).aprobado, false);

  respuesta = { ok: true, status: 200, cuerpo: { status: 'AUTHORIZED', response_code: 0, amount: 5000 } };
  await prueba.estado('TOKEN1');
  assert.equal(llamadas.at(-1).metodo, 'GET');

  respuesta = { ok: true, status: 200, cuerpo: { type: 'REVERSED', response_code: 0 } };
  assert.deepEqual(await prueba.reembolsar('TOKEN1', 5000), { ok: true, tipo: 'REVERSED', codigoRespuesta: 0 });
  assert.equal(llamadas.at(-1).url, `${raiz}/TOKEN1/refunds`);
  assert.deepEqual(llamadas.at(-1).cuerpo, { amount: 5000 });

  // Errores: el mensaje al usuario no revela nada de la pasarela
  respuesta = { ok: false, status: 401, cuerpo: { error_message: 'Not Authorized: llave SECRETA mala' } };
  await assert.rejects(prueba.confirmar('TOKEN1'), (e) => e.estado === 502 && !/SECRETA|Authorized|Tbk/.test(e.message));

  const sinRed = crearProveedorTransbank({ ambiente: 'produccion', codigoComercio: 'C', llaveSecreta: 'S' }, async () => { throw new Error('ECONNRESET 10.0.0.5'); });
  await assert.rejects(sinRed.crear({ buyOrder: 'x', sessionId: 'y', monto: 1, urlRetorno: 'z' }), (e) => e.estado === 502 && !/ECONNRESET|10\.0/.test(e.message));
  assert.throws(() => crearProveedorTransbank({ ambiente: 'inventado' }), /no válido/);

  // Producción usa la dirección real
  let urlProduccion;
  const enProduccion = crearProveedorTransbank({ ambiente: 'produccion', codigoComercio: 'C', llaveSecreta: 'S' }, async (url) => { urlProduccion = url; return { ok: true, status: 200, text: async () => '{"token":"T","url":"u"}' }; });
  await enProduccion.crear({ buyOrder: 'x', sessionId: 'y', monto: 1, urlRetorno: 'z' });
  assert.match(urlProduccion, /^https:\/\/webpay3g\.transbank\.cl\//);
});

test('webpay: la configuración de producción exige credenciales, https y no admite el proveedor simulado', () => {
  const base = { proveedor: 'transbank', ambiente: 'integracion', codigoComercio: '', llaveSecreta: '', urlPublicaApi: 'http://localhost:3000', produccion: false };
  const revisar = (p) => { const f = []; validarPagos(f, { ...base, ...p }); return f.join(' | '); };

  assert.equal(revisar({}), '');                                                                       // integración: sin exigencias
  assert.equal(revisar({ proveedor: 'simulado' }), '');                                                // desarrollo con el simulador
  assert.match(revisar({ proveedor: 'simulado', produccion: true }), /simulado/);
  assert.match(revisar({ proveedor: 'simulado', ambiente: 'produccion' }), /simulado/);
  assert.match(revisar({ ambiente: 'produccion' }), /TBK_COMMERCE_CODE/);
  assert.match(revisar({ ambiente: 'produccion', codigoComercio: '1' }), /TBK_API_KEY/);
  assert.match(revisar({ ambiente: 'produccion', codigoComercio: '1', llaveSecreta: '2' }), /https/);
  assert.equal(revisar({ ambiente: 'produccion', codigoComercio: '1', llaveSecreta: '2', urlPublicaApi: 'https://api.bajon.cl' }), '');
  assert.match(revisar({ proveedor: 'paypal' }), /PAGOS_PROVEEDOR/);
  assert.match(revisar({ ambiente: 'pruebas' }), /TBK_AMBIENTE/);
});


/* ==========================================================
   #34 PANEL ANALÍTICO DE VENTAS
   ========================================================== */

test('ventas: resuelve el rango (últimos 7 días por defecto) y rechaza rangos imposibles', () => {
  const hoy = new Date(2026, 10, 11, 15, 30);

  assert.deepEqual(resolverRango({}, hoy), { desde: '2026-11-05', hasta: '2026-11-11', dias: 7 });
  assert.deepEqual(resolverRango({ desde: '2026-11-01', hasta: '2026-11-11' }, hoy), { desde: '2026-11-01', hasta: '2026-11-11', dias: 11 });
  assert.deepEqual(resolverRango({ desde: '2026-11-11' }, hoy), { desde: '2026-11-11', hasta: '2026-11-11', dias: 1 });

  assert.throws(() => resolverRango({ desde: '2026-11-12', hasta: '2026-11-11' }, hoy), /posterior/);
  assert.throws(() => resolverRango({ desde: '2025-01-01', hasta: '2026-11-11' }, hoy), /366/);
  assert.throws(() => resolverRango({ desde: '2026-02-31', hasta: '2026-03-05' }, hoy), /no existe/);
});

test('ventas: totales, ticket promedio, días sin ventas, top, categorías, tipo de entrega y cobros', async () => {
  const admin = await entrar('maite', 'Maite1234');
  const cajero = await entrar('camila', 'Cajera2026');
  const cocinero = await entrar('pedro', 'Cocina2026');

  // Un ambiente limpio de pedidos para que las cuentas sean exactas
  db.datos.pedidos.length = 0; db.datos.detalles.length = 0; db.datos.pagos.length = 0;
  db.datos.productos.forEach((p) => { p.STOCK = 1000; });

  const mesa = await nuevoPedido(cajero, { tipoEntrega: 'Mesa 02', productos: [{ productoId: 1, cantidad: 2 }] });                    // 13.980
  const llevar = await nuevoPedido(cajero, { tipoEntrega: 'Para llevar', productos: [{ productoId: 2, cantidad: 1 }, { productoId: 3, cantidad: 3 }] });   // 3.990 + 3.600 = 7.590
  const cliente = (await api('POST', '/api/clientes', { nombre: 'Para Analitica' }, cajero)).datos.data;
  const dir = (await api('POST', `/api/clientes/${cliente.id}/direcciones`, direccion, cajero)).datos.data;
  const despacho = await nuevoPedido(cajero, { tipoEntrega: 'Despacho', idCliente: cliente.id, idDireccion: dir.id, productos: [{ productoId: 2, cantidad: 2 }] });   // 7.980
  const cancelado = await nuevoPedido(cajero, { productos: [{ productoId: 1, cantidad: 5 }] });
  const antiguo = await nuevoPedido(cajero, { productos: [{ productoId: 2, cantidad: 10 }] });

  db.datos.pedidos.find((p) => p.ID_PEDIDO === cancelado.numero).ESTADO = 'CANCELADO';
  db.datos.pedidos.find((p) => p.ID_PEDIDO === antiguo.numero).FECHA = new Date(Date.now() - 20 * 86400000);      // fuera del rango por defecto

  // Cobros: la mesa en efectivo, el despacho con tarjeta; "para llevar" queda sin cobrar
  await api('POST', '/api/pagos/efectivo', { idPedido: mesa.numero }, cajero);
  const tarjeta = (await api('POST', '/api/pagos/tarjeta', { idPedido: despacho.numero }, cajero)).datos.data;
  await pagarEnSimulador(tarjeta.token, 'aprobar');

  const r = await api('GET', '/api/analitica/ventas', null, admin);
  assert.equal(r.estado, 200);
  const v = r.datos.data;

  assert.equal(v.rango.dias, 7);
  assert.equal(v.resumen.pedidos, 3);                                      // no cuenta el cancelado ni el de hace 20 días
  assert.equal(v.resumen.total, 13980 + 7590 + 7980);
  assert.equal(v.resumen.ticketPromedio, Math.round((13980 + 7590 + 7980) / 3));

  assert.equal(v.porDia.length, 7);                                        // los 7 días, aunque no haya ventas
  assert.equal(v.porDia.at(-1).pedidos, 3);
  assert.equal(v.porDia.slice(0, 6).every((d) => d.pedidos === 0 && d.total === 0), true);

  assert.equal(v.porHora.length, 24);
  assert.equal(v.porHora.reduce((a, h) => a + h.pedidos, 0), 3);

  assert.deepEqual(v.porEntrega.map((e) => [e.tipo, e.pedidos, e.total]), [['Mesa', 1, 13980], ['Despacho', 1, 7980], ['Para llevar', 1, 7590]]);

  assert.equal(v.topProductos[0].nombre, 'La Doble Maite');
  assert.deepEqual([v.topProductos[0].unidades, v.topProductos[0].monto], [2, 13980]);
  assert.equal(v.topProductos.length, 3);
  assert.deepEqual(v.porCategoria.map((c) => [c.categoria, c.monto]), [['COMIDA', 13980 + 3990 + 7980], ['BEBIDA', 3600]]);

  assert.deepEqual(v.cobros.porMetodo.map((m) => [m.metodo, m.pagos, m.total]), [['EFECTIVO', 1, 13980], ['WEBPAY', 1, 7980]]);
  assert.deepEqual(v.cobros.sinCobrar, { pedidos: 1, total: 7590 });

  // Rango personalizado que sí incluye el pedido antiguo
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - 25 * 86400000).toISOString().slice(0, 10);
  const largo = await api('GET', `/api/analitica/ventas?desde=${desde}&hasta=${hoy}`, null, admin);
  assert.equal(largo.datos.data.resumen.pedidos, 4);
  assert.equal(largo.datos.data.porDia.length, 26);

  // Permisos y validación
  assert.equal((await api('GET', '/api/analitica/ventas', null, cajero)).estado, 403);
  assert.equal((await api('GET', '/api/analitica/ventas', null, cocinero)).estado, 403);
  assert.equal((await api('GET', '/api/analitica/ventas')).estado, 401);
  assert.equal((await api('GET', '/api/analitica/ventas?desde=ayer', null, admin)).estado, 400);
  assert.equal((await api('GET', '/api/analitica/ventas?desde=2026-02-31&hasta=2026-03-02', null, admin)).estado, 400);
  assert.equal((await api('GET', '/api/analitica/ventas?desde=2026-11-10&hasta=2026-11-01', null, admin)).estado, 400);
  assert.equal((await api('GET', '/api/analitica/ventas?desde=2020-01-01&hasta=2026-11-01', null, admin)).estado, 400);
});

test('ventas: un periodo sin pedidos devuelve ceros (no errores) y el panel funciona aunque falten las tablas de pagos', async () => {
  const admin = await entrar('maite', 'Maite1234');

  const vacio = await api('GET', '/api/analitica/ventas?desde=2020-01-01&hasta=2020-01-03', null, admin);
  assert.deepEqual(vacio.datos.data.resumen, { pedidos: 0, total: 0, ticketPromedio: 0 });
  assert.equal(vacio.datos.data.porDia.length, 3);
  assert.deepEqual(vacio.datos.data.topProductos, []);

  const sinTablaPago = {
    ...db,
    ejecutar: async (sql, b) => {
      if (/analitica_por_metodo|analitica_sin_cobrar/.test(sql)) throw Object.assign(new Error('ORA-00942'), { errorNum: 942 });
      return db.ejecutar(sql, b);
    }
  };
  const app = await escuchar(crearApp({ db: sinTablaPago, proveedorPagos: proveedor, configPagos }));
  const urlBase = `http://localhost:${app.address().port}`;
  const admin2 = await entrar('maite', 'Maite1234', urlBase);

  const r = await api('GET', '/api/analitica/ventas', null, admin2, urlBase);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.data.cobros, null);
  assert.ok(r.datos.data.resumen.pedidos >= 0);
});


/* ==========================================================
   RESPALDO: las tablas nuevas
   ========================================================== */

test('respaldo: incluye clientes, direcciones y pagos; al restaurar uno antiguo vacía las tablas que no estaban', async () => {
  const cajero = await entrar('camila', 'Cajera2026');
  const cliente = (await api('POST', '/api/clientes', { nombre: 'Cliente Respaldo', telefono: '933332222' }, cajero)).datos.data;
  await api('POST', `/api/clientes/${cliente.id}/direcciones`, direccion, cajero);
  const pedido = await nuevoPedido(cajero);
  await api('POST', '/api/pagos/efectivo', { idPedido: pedido.numero }, cajero);

  const opciones = { dir: carpetaRespaldos, max: 10 };
  const respaldo = await backup.crearRespaldo(db, opciones);

  assert.ok(respaldo.tablas.CLIENTE_PERFIL >= 1);
  assert.ok(respaldo.tablas.DIRECCION_DESPACHO >= 1);
  assert.ok(respaldo.tablas.PAGO >= 1);

  // Restauración normal: todo vuelve
  const pagosAntes = db.datos.pagos.length;
  db.datos.pagos.length = 0; db.datos.direcciones.length = 0; db.datos.perfiles.length = 0;
  const r = await backup.restaurarRespaldo(db, respaldo.archivo, opciones);

  assert.equal(db.datos.pagos.length, pagosAntes);
  assert.ok(db.datos.direcciones.length >= 1);
  assert.ok(db.datos.perfiles.some((p) => p.TELEFONO === '933332222'));
  assert.deepEqual(r.vaciadas, []);
  assert.ok(db.datos.borradas.indexOf('PAGO') < db.datos.borradas.indexOf('PEDIDO'));      // primero se borran los pagos que dependen de los pedidos
  assert.ok(db.datos.insertadas.indexOf('PEDIDO') < db.datos.insertadas.indexOf('PAGO'));

  // Respaldo "antiguo" (de antes de que existieran los pagos): al restaurarlo, los pagos de hoy se vacían
  const ruta = path.join(carpetaRespaldos, 'respaldo-20200101-000009.json');
  const contenido = JSON.parse(readFileSync(path.join(carpetaRespaldos, respaldo.archivo), 'utf8'));
  for (const tabla of ['PAGO', 'CLIENTE_PERFIL', 'DIRECCION_DESPACHO']) delete contenido.tablas[tabla];
  contenido.integridad = createHash('sha256').update(JSON.stringify(contenido.tablas)).digest('hex');
  writeFileSync(ruta, JSON.stringify(contenido));

  const antiguo = await backup.restaurarRespaldo(db, 'respaldo-20200101-000009.json', opciones);

  assert.deepEqual([...antiguo.vaciadas].sort(), ['CLIENTE_PERFIL', 'DIRECCION_DESPACHO', 'PAGO']);
  assert.equal(db.datos.pagos.length, 0);
  assert.equal(db.datos.direcciones.length, 0);
  assert.equal(db.datos.perfiles.length, 0);
  assert.ok(readdirSync(carpetaRespaldos).some((n) => n.startsWith('seguridad-')));
});
