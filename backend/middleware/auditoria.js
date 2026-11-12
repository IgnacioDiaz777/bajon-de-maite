/* ==========================================================
   MIDDLEWARE DE AUDITORÍA
   Sprint 4 · #29 Auditoría y logs de transacciones

   Se agrega a una ruta y, cuando la respuesta termina, guarda
   en AUDITORIA qué pasó:  EXITO (código < 400) o FALLO.

     router.post('/', autenticar, auditar(db, { accion: 'PRODUCTO_CREAR', entidad: 'PRODUCTO' }), ...)

   Si lo pones ANTES de exigirRol(...) también queda registrado
   cuando alguien intenta algo sin permiso (queda como FALLO).
   ========================================================== */

import { registrarAuditoria } from '../services/auditService.js';


export const ipDe = (req) => req.ip || (req.socket && req.socket.remoteAddress) || '';

/*
  opciones:
    accion     texto fijo, ej. 'PEDIDO_CREAR'
    entidad    tabla o módulo afectado, ej. 'PEDIDO'
    idEntidad  (req, cuerpo) => id del registro afectado
    detalle    (req, cuerpo) => texto breve (NUNCA contraseñas ni tokens)
    actor      (req, cuerpo) => { idUsuario, usuario, rol }  (por defecto, el usuario del token)
*/
export const auditar = (db, { accion, entidad, idEntidad, detalle, actor }) => (req, res, next) => {
  const jsonOriginal = res.json.bind(res);

  // Guardamos lo que responde la API para poder leer el id creado o el mensaje de error
  res.json = (cuerpo) => {
    res.locals.cuerpo = cuerpo;
    return jsonOriginal(cuerpo);
  };

  res.on('finish', () => {
    const cuerpo = res.locals.cuerpo || {};
    const exito = res.statusCode < 400;

    const quien = actor
      ? actor(req, cuerpo)
      : { idUsuario: req.usuario && req.usuario.id, usuario: req.usuario && req.usuario.usuario, rol: req.usuario && req.usuario.rol };

    const texto = exito
      ? (detalle ? detalle(req, cuerpo) : '')
      : `${res.statusCode}: ${(cuerpo.errors || []).join(' ')}`;

    registrarAuditoria(db, {
      ...quien,
      accion,
      entidad,
      idEntidad: idEntidad ? idEntidad(req, cuerpo) : undefined,
      resultado: exito ? 'EXITO' : 'FALLO',
      detalle: texto,
      ip: ipDe(req)
    });
  });

  next();
};
