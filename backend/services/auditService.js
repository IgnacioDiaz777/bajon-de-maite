/* ==========================================================
   AUDITORÍA DE TRANSACCIONES
   Sprint 4 · #29 Auditoría y logs de transacciones
   Tabla AUDITORIA: quién hizo qué, cuándo y con qué resultado.

   registrarAuditoria() NUNCA lanza errores: si la auditoría
   falla (por ejemplo, porque aún no se crearon las tablas del
   Sprint 4), la operación del usuario sigue funcionando y el
   problema queda en los logs.
   ========================================================== */

import { logger } from './logger.js';


// Tamaños de las columnas de AUDITORIA (para no pasarse del límite)
const LIMITES = { usuario: 50, rol: 20, accion: 40, entidad: 30, idEntidad: 40, detalle: 500, ip: 45 };

const recortar = (valor, maximo) => (valor === undefined || valor === null || valor === '')
  ? null
  : String(valor).slice(0, maximo);


export async function registrarAuditoria(db, evento) {
  const {
    idUsuario = null, usuario, rol, accion, entidad, idEntidad,
    resultado = 'EXITO', detalle, ip
  } = evento;

  const fila = {
    idUsuario: Number.isInteger(idUsuario) ? idUsuario : null,
    usuario: recortar(usuario, LIMITES.usuario),
    rol: recortar(rol, LIMITES.rol),
    accion: recortar(accion, LIMITES.accion),
    entidad: recortar(entidad, LIMITES.entidad),
    idEntidad: recortar(idEntidad, LIMITES.idEntidad),
    resultado: resultado === 'FALLO' ? 'FALLO' : 'EXITO',
    detalle: recortar(detalle, LIMITES.detalle),
    ip: recortar(ip, LIMITES.ip)
  };

  // Siempre queda en el archivo de logs, aunque falle la base de datos
  logger.info('auditoria', fila);

  try {
    await db.ejecutar(`
      /* auditoria_registrar */
      INSERT INTO auditoria (id_usuario, usuario, rol, accion, entidad, id_entidad, resultado, detalle, ip)
      VALUES (:idUsuario, :usuario, :rol, :accion, :entidad, :idEntidad, :resultado, :detalle, :ip)`, fila);
  } catch (error) {
    logger.error('No se pudo guardar la auditoría en la base de datos', { accion: fila.accion, motivo: error.message });
  }
}


/* ---------- Consulta (solo administrador) ---------- */

const aAuditoria = (r) => ({
  id: r.ID_AUDITORIA,
  fecha: r.FECHA,
  usuario: r.USUARIO || '—',
  rol: r.ROL || '',
  accion: r.ACCION,
  entidad: r.ENTIDAD || '',
  idEntidad: r.ID_ENTIDAD || '',
  resultado: r.RESULTADO,
  detalle: r.DETALLE || '',
  ip: r.IP || ''
});


export async function listarAuditoria(db, { usuario, accion, resultado, desde, hasta, limite = 100 } = {}) {
  // Los filtros se agregan solo si vienen; los valores siempre van como binds (:nombre)
  const condiciones = [];
  const binds = { limite };

  if (usuario) { condiciones.push('LOWER(usuario) = LOWER(:usuario)'); binds.usuario = usuario; }
  if (accion) { condiciones.push('accion = :accion'); binds.accion = accion; }
  if (resultado) { condiciones.push('resultado = :resultado'); binds.resultado = resultado; }
  if (desde) { condiciones.push(`fecha >= TO_DATE(:desde, 'YYYY-MM-DD')`); binds.desde = desde; }
  if (hasta) { condiciones.push(`fecha < TO_DATE(:hasta, 'YYYY-MM-DD') + 1`); binds.hasta = hasta; }

  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.ejecutar(`
    /* auditoria_listar */
    SELECT id_auditoria, fecha, usuario, rol, accion, entidad, id_entidad, resultado, detalle, ip
      FROM auditoria
     ${donde}
     ORDER BY fecha DESC, id_auditoria DESC
     FETCH FIRST :limite ROWS ONLY`, binds);

  return rows.map(aAuditoria);
}
