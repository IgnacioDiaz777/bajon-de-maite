/* ==========================================================
   CLIENTES: PERFILES Y DIRECCIONES DE DESPACHO
   Tarea #33 Módulo de Gestión de Perfiles y Direcciones de Despacho

   Tablas: CLIENTE (la de siempre: nombre y activo),
           CLIENTE_PERFIL (teléfono, correo, notas),
           DIRECCION_DESPACHO (varias por cliente, una principal).
   ========================================================== */

import { ErrorApp, primerValor } from './errores.js';


const MAX_DIRECCIONES = 5;

const aDireccion = (r) => ({
  id: r.ID_DIRECCION,
  alias: r.ALIAS,
  calle: r.CALLE,
  numero: r.NUMERO,
  depto: r.DEPTO || '',
  comuna: r.COMUNA,
  ciudad: r.CIUDAD,
  referencia: r.REFERENCIA || '',
  esPrincipal: r.ES_PRINCIPAL === 1
});

const aCliente = (r) => ({
  id: r.ID_CLIENTE,
  nombre: r.NOMBRE,
  telefono: r.TELEFONO || '',
  email: r.EMAIL || '',
  notas: r.NOTAS || ''
});

// "Av. Providencia 1234, depto 56, Providencia" (sin corchetes: el destino del pedido se guarda entre [ ])
export function resumenDireccion(d) {
  const partes = [`${d.calle} ${d.numero}`, d.depto ? `depto ${d.depto}` : '', d.comuna];
  return partes.filter(Boolean).join(', ').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
}

// Para buscar con LIKE sin que "%" o "_" del usuario actúen como comodines
const patron = (texto) => `%${texto.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;


/* ---------- Clientes ---------- */

export async function listarClientes(db, { buscar = '', limite = 50 } = {}) {
  const binds = { limite };
  let filtro = '';

  if (buscar) {
    filtro = `AND (LOWER(c.nombre) LIKE :buscar ESCAPE '\\' OR p.telefono LIKE :buscar ESCAPE '\\')`;
    binds.buscar = patron(buscar);
  }

  const { rows } = await db.ejecutar(`
    /* clientes_listar */
    SELECT c.id_cliente, c.nombre, p.telefono, p.email, p.notas,
           (SELECT COUNT(*) FROM direccion_despacho d WHERE d.id_cliente = c.id_cliente AND d.activa = 1) AS direcciones
      FROM cliente c
      LEFT JOIN cliente_perfil p ON p.id_cliente = c.id_cliente
     WHERE c.activo = 1 ${filtro}
     ORDER BY LOWER(c.nombre)
     FETCH FIRST :limite ROWS ONLY`, binds);

  return rows.map((r) => ({ ...aCliente(r), cantidadDirecciones: r.DIRECCIONES }));
}

export async function obtenerCliente(db, id) {
  const { rows } = await db.ejecutar(`
    /* cliente_obtener */
    SELECT c.id_cliente, c.nombre, p.telefono, p.email, p.notas
      FROM cliente c
      LEFT JOIN cliente_perfil p ON p.id_cliente = c.id_cliente
     WHERE c.id_cliente = :id AND c.activo = 1`, { id });

  if (!rows.length) throw new ErrorApp(404, 'El cliente no existe.');

  const direcciones = await db.ejecutar(`
    /* direcciones_listar */
    SELECT id_direccion, alias, calle, numero, depto, comuna, ciudad, referencia, es_principal
      FROM direccion_despacho
     WHERE id_cliente = :id AND activa = 1
     ORDER BY es_principal DESC, id_direccion`, { id });

  return { ...aCliente(rows[0]), direcciones: direcciones.rows.map(aDireccion) };
}

async function verificarNombreLibre(s, nombre, idActual = 0) {
  const { rows } = await s.ejecutar(`
    /* cliente_nombre_duplicado */
    SELECT id_cliente FROM cliente
     WHERE LOWER(nombre) = LOWER(:nombre) AND activo = 1 AND id_cliente <> :id`, { nombre, id: idActual });

  if (rows.length) throw new ErrorApp(409, 'Ya existe un cliente con ese nombre. Búscalo en la lista y edítalo.');
}

// Crea o actualiza el perfil (teléfono, correo, notas) del cliente
function guardarPerfil(s, id, datos) {
  return s.ejecutar(`
    /* cliente_perfil_guardar */
    MERGE INTO cliente_perfil p
    USING (SELECT :id AS id_cliente FROM dual) o ON (p.id_cliente = o.id_cliente)
    WHEN MATCHED THEN UPDATE SET p.telefono = :telefono, p.email = :email, p.notas = :notas, p.fecha_actualizacion = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (id_cliente, telefono, email, notas) VALUES (:id, :telefono, :email, :notas)`,
  { id, telefono: datos.telefono || null, email: datos.email || null, notas: datos.notas || null });
}

export async function crearCliente(db, datos) {
  return db.sesion(async (s) => {
    await verificarNombreLibre(s, datos.nombre);

    const resultado = await s.ejecutar(`
      /* cliente_crear */
      INSERT INTO cliente (nombre) VALUES (:nombre)
      RETURNING id_cliente INTO :id`, { nombre: datos.nombre, id: s.salidaNumero });

    const id = primerValor(resultado.outBinds.id);
    await guardarPerfil(s, id, datos);

    return { id, nombre: datos.nombre, telefono: datos.telefono || '', email: datos.email || '', notas: datos.notas || '', direcciones: [] };
  });
}

export async function actualizarCliente(db, id, datos) {
  await db.sesion(async (s) => {
    await verificarNombreLibre(s, datos.nombre, id);

    const resultado = await s.ejecutar(`
      /* cliente_actualizar */
      UPDATE cliente SET nombre = :nombre WHERE id_cliente = :id AND activo = 1`, { nombre: datos.nombre, id });

    if (!resultado.rowsAffected) throw new ErrorApp(404, 'El cliente no existe.');

    await guardarPerfil(s, id, datos);
  });

  return obtenerCliente(db, id);
}

// No se borra: queda inactivo (los pedidos antiguos siguen apuntando a él)
export async function desactivarCliente(db, id) {
  const resultado = await db.ejecutar(`
    /* cliente_desactivar */
    UPDATE cliente SET activo = 0 WHERE id_cliente = :id AND activo = 1`, { id });

  if (!resultado.rowsAffected) throw new ErrorApp(404, 'El cliente no existe.');
}


/* ---------- Direcciones ---------- */

async function verificarCliente(s, idCliente) {
  const { rows } = await s.ejecutar(`/* cliente_existe */ SELECT id_cliente FROM cliente WHERE id_cliente = :id AND activo = 1`, { id: idCliente });
  if (!rows.length) throw new ErrorApp(404, 'El cliente no existe.');
}

// Deja solo UNA dirección principal por cliente
const quitarPrincipales = (s, idCliente, exceptoId = 0) => s.ejecutar(`
  /* direcciones_quitar_principal */
  UPDATE direccion_despacho SET es_principal = 0
   WHERE id_cliente = :idCliente AND es_principal = 1 AND id_direccion <> :exceptoId`, { idCliente, exceptoId });

export async function crearDireccion(db, idCliente, datos) {
  const id = await db.sesion(async (s) => {
    await verificarCliente(s, idCliente);

    const { rows } = await s.ejecutar(`/* direcciones_contar */ SELECT COUNT(*) AS n FROM direccion_despacho WHERE id_cliente = :idCliente AND activa = 1`, { idCliente });
    const existentes = rows[0].N;

    if (existentes >= MAX_DIRECCIONES) throw new ErrorApp(409, `Un cliente puede tener hasta ${MAX_DIRECCIONES} direcciones. Elimina alguna para agregar otra.`);

    const principal = datos.esPrincipal || existentes === 0;      // la primera siempre es la principal

    if (principal) await quitarPrincipales(s, idCliente, 0);

    const resultado = await s.ejecutar(`
      /* direccion_crear */
      INSERT INTO direccion_despacho (id_cliente, alias, calle, numero, depto, comuna, ciudad, referencia, es_principal)
      VALUES (:idCliente, :alias, :calle, :numero, :depto, :comuna, :ciudad, :referencia, :principal)
      RETURNING id_direccion INTO :id`,
    {
      idCliente, alias: datos.alias, calle: datos.calle, numero: datos.numero, depto: datos.depto || null,
      comuna: datos.comuna, ciudad: datos.ciudad, referencia: datos.referencia || null, principal: principal ? 1 : 0, id: s.salidaNumero
    });

    const nuevo = primerValor(resultado.outBinds.id);

    return nuevo;
  });

  return obtenerCliente(db, idCliente).then((c) => c.direcciones.find((d) => d.id === id));
}

export async function actualizarDireccion(db, idCliente, idDireccion, datos) {
  await db.sesion(async (s) => {
    const resultado = await s.ejecutar(`
      /* direccion_actualizar */
      UPDATE direccion_despacho
         SET alias = :alias, calle = :calle, numero = :numero, depto = :depto, comuna = :comuna,
             ciudad = :ciudad, referencia = :referencia, es_principal = CASE WHEN :principal = 1 THEN 1 ELSE es_principal END
       WHERE id_direccion = :idDireccion AND id_cliente = :idCliente AND activa = 1`,
    {
      alias: datos.alias, calle: datos.calle, numero: datos.numero, depto: datos.depto || null, comuna: datos.comuna,
      ciudad: datos.ciudad, referencia: datos.referencia || null, principal: datos.esPrincipal ? 1 : 0, idDireccion, idCliente
    });

    if (!resultado.rowsAffected) throw new ErrorApp(404, 'La dirección no existe.');
    if (datos.esPrincipal) await quitarPrincipales(s, idCliente, idDireccion);
  });

  return obtenerCliente(db, idCliente).then((c) => c.direcciones.find((d) => d.id === idDireccion));
}

export async function eliminarDireccion(db, idCliente, idDireccion) {
  await db.sesion(async (s) => {
    const { rows } = await s.ejecutar(`
      /* direccion_estado */
      SELECT es_principal FROM direccion_despacho WHERE id_direccion = :idDireccion AND id_cliente = :idCliente AND activa = 1`,
    { idDireccion, idCliente });

    if (!rows.length) throw new ErrorApp(404, 'La dirección no existe.');

    // No se borra: los pedidos viejos guardaron su texto, pero así queda el historial
    await s.ejecutar(`/* direccion_desactivar */ UPDATE direccion_despacho SET activa = 0, es_principal = 0 WHERE id_direccion = :idDireccion`, { idDireccion });

    // Si era la principal, otra pasa a serlo
    if (rows[0].ES_PRINCIPAL === 1) {
      await s.ejecutar(`
        /* direccion_nueva_principal */
        UPDATE direccion_despacho SET es_principal = 1
         WHERE id_direccion = (SELECT MIN(id_direccion) FROM direccion_despacho WHERE id_cliente = :idCliente AND activa = 1)`, { idCliente });
    }
  });
}

// Para el pedido con despacho: la dirección debe existir, estar activa y pertenecer a ese cliente
export async function direccionDeCliente(db, idCliente, idDireccion) {
  const { rows } = await db.ejecutar(`
    /* direccion_para_pedido */
    SELECT calle, numero, depto, comuna FROM direccion_despacho
     WHERE id_direccion = :idDireccion AND id_cliente = :idCliente AND activa = 1`, { idDireccion, idCliente });

  if (!rows.length) throw new ErrorApp(400, 'La dirección elegida no existe o no pertenece a ese cliente.');

  const r = rows[0];
  return resumenDireccion({ calle: r.CALLE, numero: r.NUMERO, depto: r.DEPTO, comuna: r.COMUNA });
}
