/* ==========================================================
   FEEDBACK Y REPORTE DE FALLOS
   Sprint 4 · #28 Módulo de Feedback y reporte de fallos
   Tabla FEEDBACK: sugerencias, comentarios y fallos que
   reportan los usuarios (o que detecta la propia app).
   ========================================================== */

import { ErrorApp, primerValor } from './errores.js';


const aFeedback = (r) => ({
  id: r.ID_FEEDBACK,
  fecha: r.FECHA,
  usuario: r.USUARIO || '—',
  tipo: r.TIPO,
  gravedad: r.GRAVEDAD || '',
  titulo: r.TITULO,
  descripcion: r.DESCRIPCION,
  pantalla: r.PANTALLA || '',
  origen: r.ORIGEN,
  estado: r.ESTADO,
  fechaResolucion: r.FECHA_RESOLUCION || null
});


export async function crearFeedback(db, autor, datos) {
  // La gravedad solo tiene sentido en los fallos
  const gravedad = datos.tipo === 'FALLO' ? datos.gravedad : null;

  const resultado = await db.ejecutar(`
    /* feedback_crear */
    INSERT INTO feedback (id_usuario, usuario, tipo, gravedad, titulo, descripcion, pantalla, origen)
    VALUES (:idUsuario, :usuario, :tipo, :gravedad, :titulo, :descripcion, :pantalla, :origen)
    RETURNING id_feedback INTO :id`,
    {
      idUsuario: autor.id,
      usuario: autor.usuario,
      tipo: datos.tipo,
      gravedad,
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      pantalla: datos.pantalla || null,
      origen: datos.origen,
      id: db.salidaNumero
    });

  return { id: primerValor(resultado.outBinds.id), ...datos, gravedad: gravedad || '', estado: 'ABIERTO' };
}


/* El administrador ve todo; el resto de los roles solo ve lo que ellos mismos enviaron */
export async function listarFeedback(db, usuario, { estado, tipo, limite = 100 } = {}) {
  const condiciones = [];
  const binds = { limite };

  if (usuario.rol !== 'administrador') { condiciones.push('id_usuario = :idUsuario'); binds.idUsuario = usuario.id; }
  if (estado) { condiciones.push('estado = :estado'); binds.estado = estado; }
  if (tipo) { condiciones.push('tipo = :tipo'); binds.tipo = tipo; }

  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.ejecutar(`
    /* feedback_listar */
    SELECT id_feedback, fecha, usuario, tipo, gravedad, titulo, descripcion, pantalla, origen, estado, fecha_resolucion
      FROM feedback
     ${donde}
     ORDER BY fecha DESC, id_feedback DESC
     FETCH FIRST :limite ROWS ONLY`, binds);

  return rows.map(aFeedback);
}


export async function cambiarEstadoFeedback(db, id, estado) {
  const resultado = await db.ejecutar(`
    /* feedback_cambiar_estado */
    UPDATE feedback
       SET estado = :estado,
           fecha_resolucion = CASE WHEN :estado = 'RESUELTO' THEN SYSTIMESTAMP ELSE NULL END
     WHERE id_feedback = :id`, { estado, id });

  if (!resultado.rowsAffected) throw new ErrorApp(404, 'El reporte no existe.');

  return { id, estado };
}


/* ---------- Límite de envíos (evita llenar la tabla por error o a propósito) ---------- */

const MAX_ENVIOS_POR_HORA = 20;
const enviosPorUsuario = new Map();   // idUsuario → [marcas de tiempo]

export function limitarEnvios(idUsuario, ahora = Date.now()) {
  const desde = ahora - 60 * 60 * 1000;
  const recientes = (enviosPorUsuario.get(idUsuario) || []).filter((t) => t > desde);

  if (recientes.length >= MAX_ENVIOS_POR_HORA) {
    enviosPorUsuario.set(idUsuario, recientes);
    throw new ErrorApp(429, 'Enviaste muchos reportes en poco tiempo. Inténtalo más tarde.');
  }

  recientes.push(ahora);
  enviosPorUsuario.set(idUsuario, recientes);
}

export function reiniciarLimiteEnvios() {
  enviosPorUsuario.clear();
}
