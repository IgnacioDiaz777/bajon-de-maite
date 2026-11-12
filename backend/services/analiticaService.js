/* ==========================================================
   PANEL ANALÍTICO DE VENTAS BÁSICAS
   Tarea #34

   Una "venta" es un pedido que no fue cancelado. Se cuenta por la
   fecha en que se registró el pedido. Todo se calcula en Oracle con
   GROUP BY (no se traen los pedidos al servidor) y solo lee datos.
   ========================================================== */

import { ErrorApp } from './errores.js';


const MAX_DIAS = 366;
const DIA_MS = 24 * 60 * 60 * 1000;

const aFechaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 'YYYY-MM-DD' a Date a mediodía (evita saltos por cambio de horario)
const aFecha = (texto) => {
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(a, m - 1, d, 12);

  // 2026-02-31 no existe: JavaScript lo "corrige" a marzo, así que se compara
  return aFechaISO(fecha) === texto ? fecha : null;
};

/* Resuelve el rango pedido (por defecto, los últimos 7 días incluido hoy) y lo valida */
export function resolverRango({ desde, hasta } = {}, hoy = new Date()) {
  const fin = hasta ? aFecha(hasta) : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12);
  const inicio = desde ? aFecha(desde) : new Date(fin.getTime() - 6 * DIA_MS);

  if (!inicio || !fin) throw new ErrorApp(400, 'Una de las fechas no existe.');
  if (inicio > fin) throw new ErrorApp(400, 'La fecha "desde" no puede ser posterior a "hasta".');

  const dias = Math.round((fin - inicio) / DIA_MS) + 1;
  if (dias > MAX_DIAS) throw new ErrorApp(400, `El rango máximo es de ${MAX_DIAS} días.`);

  return { desde: aFechaISO(inicio), hasta: aFechaISO(fin), dias };
}

// Lista de todos los días del rango, con ceros donde no hubo ventas (para que el gráfico no se "salte" días)
function completarDias(rango, filas) {
  const porDia = new Map(filas.map((f) => [f.DIA, f]));
  const dias = [];

  for (let d = aFecha(rango.desde); aFechaISO(d) <= rango.hasta; d = new Date(d.getTime() + DIA_MS)) {
    const dia = aFechaISO(d);
    const f = porDia.get(dia);
    dias.push({ dia, pedidos: f ? f.PEDIDOS : 0, total: f ? f.TOTAL : 0 });
  }

  return dias;
}

const REDONDEAR = (n) => Math.round(Number(n) || 0);


export async function ventasDelPeriodo(db, filtros = {}, hoy = new Date()) {
  const rango = resolverRango(filtros, hoy);
  const b = { desde: rango.desde, hasta: rango.hasta };

  // El mismo filtro para todas las consultas: pedidos no cancelados dentro del rango (los valores siempre van como binds)
  const FILTRO_PEDIDO = `p.estado <> 'CANCELADO' AND p.fecha >= TO_DATE(:desde, 'YYYY-MM-DD') AND p.fecha < TO_DATE(:hasta, 'YYYY-MM-DD') + 1`;

  const [resumen, porDia, porHora, porEntrega, topProductos, porCategoria] = await Promise.all([
    db.ejecutar(`
      /* analitica_resumen */
      SELECT COUNT(*) AS pedidos, NVL(SUM(p.total), 0) AS total FROM pedido p WHERE ${FILTRO_PEDIDO}`, b),

    db.ejecutar(`
      /* analitica_por_dia */
      SELECT TO_CHAR(TRUNC(p.fecha), 'YYYY-MM-DD') AS dia, COUNT(*) AS pedidos, NVL(SUM(p.total), 0) AS total
        FROM pedido p WHERE ${FILTRO_PEDIDO}
       GROUP BY TRUNC(p.fecha) ORDER BY TRUNC(p.fecha)`, b),

    db.ejecutar(`
      /* analitica_por_hora */
      SELECT TO_NUMBER(TO_CHAR(p.fecha, 'HH24')) AS hora, COUNT(*) AS pedidos
        FROM pedido p WHERE ${FILTRO_PEDIDO}
       GROUP BY TO_CHAR(p.fecha, 'HH24') ORDER BY 1`, b),

    // El destino se guarda al inicio de las observaciones: "[Mesa 03] ...", "[Despacho: ...] ...", "[Para llevar] ..."
    db.ejecutar(`
      /* analitica_por_entrega */
      SELECT CASE WHEN p.observaciones LIKE '[Despacho%' THEN 'Despacho'
                  WHEN p.observaciones LIKE '[Mesa%' THEN 'Mesa'
                  ELSE 'Para llevar' END AS tipo,
             COUNT(*) AS pedidos, NVL(SUM(p.total), 0) AS total
        FROM pedido p WHERE ${FILTRO_PEDIDO}
       GROUP BY CASE WHEN p.observaciones LIKE '[Despacho%' THEN 'Despacho'
                     WHEN p.observaciones LIKE '[Mesa%' THEN 'Mesa'
                     ELSE 'Para llevar' END
       ORDER BY 3 DESC`, b),

    db.ejecutar(`
      /* analitica_top_productos */
      SELECT pr.nombre, pr.categoria, SUM(d.cantidad) AS unidades, SUM(d.cantidad * d.precio_unitario) AS monto
        FROM detalle_pedido d
        JOIN pedido p ON p.id_pedido = d.id_pedido
        JOIN producto pr ON pr.id_producto = d.id_producto
       WHERE ${FILTRO_PEDIDO}
       GROUP BY pr.id_producto, pr.nombre, pr.categoria
       ORDER BY monto DESC, unidades DESC
       FETCH FIRST 5 ROWS ONLY`, b),

    db.ejecutar(`
      /* analitica_por_categoria */
      SELECT pr.categoria, SUM(d.cantidad) AS unidades, SUM(d.cantidad * d.precio_unitario) AS monto
        FROM detalle_pedido d
        JOIN pedido p ON p.id_pedido = d.id_pedido
        JOIN producto pr ON pr.id_producto = d.id_producto
       WHERE ${FILTRO_PEDIDO}
       GROUP BY pr.categoria
       ORDER BY monto DESC`, b)
  ]);

  const pedidos = resumen.rows[0].PEDIDOS;
  const total = REDONDEAR(resumen.rows[0].TOTAL);

  // Cobros: si todavía no se crearon las tablas de pagos, el panel funciona igual (sin esta parte)
  let cobros = null;

  try {
    const [metodos, sinCobrar] = await Promise.all([
      db.ejecutar(`
        /* analitica_por_metodo */
        SELECT g.metodo, COUNT(*) AS pagos, NVL(SUM(g.monto), 0) AS total
          FROM pago g JOIN pedido p ON p.id_pedido = g.id_pedido
         WHERE g.estado = 'AUTORIZADO' AND ${FILTRO_PEDIDO}
         GROUP BY g.metodo ORDER BY 3 DESC`, b),

      db.ejecutar(`
        /* analitica_sin_cobrar */
        SELECT COUNT(*) AS pedidos, NVL(SUM(p.total), 0) AS total
          FROM pedido p
         WHERE ${FILTRO_PEDIDO}
           AND NOT EXISTS (SELECT 1 FROM pago g WHERE g.id_pedido = p.id_pedido AND g.estado = 'AUTORIZADO')`, b)
    ]);

    cobros = {
      porMetodo: metodos.rows.map((r) => ({ metodo: r.METODO, pagos: r.PAGOS, total: REDONDEAR(r.TOTAL) })),
      sinCobrar: { pedidos: sinCobrar.rows[0].PEDIDOS, total: REDONDEAR(sinCobrar.rows[0].TOTAL) }
    };
  } catch (error) {
    if (error.errorNum !== 942) throw error;
  }

  // Las 24 horas del día, aunque en algunas no haya habido pedidos
  const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, pedidos: (porHora.rows.find((r) => r.HORA === hora) || {}).PEDIDOS || 0 }));

  return {
    rango,
    resumen: { pedidos, total, ticketPromedio: pedidos ? Math.round(total / pedidos) : 0 },
    porDia: completarDias(rango, porDia.rows).map((d) => ({ ...d, total: REDONDEAR(d.total) })),
    porHora: horas,
    porEntrega: porEntrega.rows.map((r) => ({ tipo: r.TIPO, pedidos: r.PEDIDOS, total: REDONDEAR(r.TOTAL) })),
    topProductos: topProductos.rows.map((r) => ({ nombre: r.NOMBRE, categoria: r.CATEGORIA, unidades: r.UNIDADES, monto: REDONDEAR(r.MONTO) })),
    porCategoria: porCategoria.rows.map((r) => ({ categoria: r.CATEGORIA, unidades: r.UNIDADES, monto: REDONDEAR(r.MONTO) })),
    cobros
  };
}
