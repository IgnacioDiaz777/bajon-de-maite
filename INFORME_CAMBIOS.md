# Informe de cambios — integración con Oracle

## 1. Qué había al recibir el proyecto

- **Frontend** (HTML/CSS/JS en carpetas por sección): completo, con datos de prueba en archivos JSON.
- **Backend** (`backend/`, Express + Joi + JWT): solo validaba datos y respondía "éxito" sin guardar nada; el login comparaba contra una cuenta fija (`admin@elbajon.cl` / `1234`) escrita en el código; la clave del token (`JWT_SECRET`) también estaba escrita en el código.
- **Base de datos** (`bajondemaite.sql`): 10 tablas, el tipo `T_LISTA_ITEMS`, el trigger `TRG_CALCULA_SUBTOTAL` y el procedimiento `SP_CREAR_PEDIDO`. **No trae ningún dato** (todas las tablas vacías) y no había conexión con Oracle en el código.

## 2. Qué se hizo

**Backend (nuevo y modificado)**
- Conexión a Oracle con `node-oracledb` (modo *thin*, sin instalar Oracle Client), pool de conexiones, soporte de cartera (wallet) y configuración por `.env`.
- Login real contra `USUARIO` (contraseña con hash scrypt + sal; el rol se obtiene según `ADMINISTRADOR` / `CAJERO` / `COCINERO`).
- Productos: consultar, crear, editar y eliminar sobre `PRODUCTO`, respetando `CHK_CAT_PROD`, `CHK_PRECIO_PROD`, `CHK_STOCK_PROD` y la clave foránea `FK_DETALLE_PRODUCTO`.
- Pedidos: se registran con `SP_CREAR_PEDIDO` (con el tipo `T_LISTA_ITEMS`), el cliente se busca o crea en `CLIENTE`, y el seguimiento (en preparación → listo → entregado) actualiza `PEDIDO.ESTADO` según `CHK_ESTADO_PED`.
- Registro de usuarios por rol (solo administrador) y scripts `probar-conexion` y `crear-usuario`.
- Rutas protegidas con JWT y permisos por rol.
- Todas las consultas usan parámetros (`:nombre`); los errores de Oracle no se muestran al usuario.

**Frontend (modificado, mismo diseño)**
- Todo lo que se ve (productos, stock, pedidos en cocina) viene ahora de Oracle a través de la API.
- Login, productos (añadir/editar/eliminar) y pedidos (crear, marcar listo/entregado) guardan en la base de datos.
- Botones y secciones se ajustan al rol (por ejemplo, el cocinero no ve "Añadir plato" ni el formulario de pedidos).
- Se eliminaron los datos ficticios (`usuarios.json` con contraseñas, `pedidos.json`, `productos.json`). Las fotos/emoji/rating, que no existen en Oracle, quedaron en `catalogo-visual.json` asociados al nombre del producto (conservando las rutas de imagen del equipo).

## 3. Errores corregidos en el código del equipo

1. Login con credenciales fijas en el código → ahora consulta `USUARIO` con contraseña hasheada.
2. `JWT_SECRET` escrito en el código → ahora viene de `.env` (el servidor no arranca sin él).
3. `/api/productos` y `/api/pedidos` estaban abiertas a cualquiera → ahora exigen sesión y rol.
4. El frontend guardaba el token en `localStorage`, nunca lo enviaba y no lo borraba al cerrar sesión → ahora usa `sessionStorage`, lo envía en cada petición y lo borra al salir; si vence, vuelve al login.
5. Editar un producto enviaba un `POST` (creaba) y eliminar no avisaba al servidor → ahora usan `PUT` y `DELETE`.
6. Al enviar un pedido el frontend lo registraba otra vez de forma local después de validarlo → ahora hay una sola llamada y el estado vuelve desde Oracle.
7. El selector ofrecía "Mesa 05" pero el validador solo aceptaba hasta "Mesa 04" → corregido.
8. El validador de login exigía un correo, pero `USUARIO` no tiene columna de correo → ahora se usa `NOMBRE_USUARIO`.
9. Las categorías "plato/extra" no cumplían `CHK_CAT_PROD` (COMIDA, BEBIDA, POSTRE, OTRO) → la app usa las categorías de la base.
10. El estado "Pocas unidades" se calculaba con umbrales distintos (≤3 en el formulario, ≤5 en la lista) → ahora se deduce siempre del stock.
11. Los validadores no reemplazaban `req.body` por los valores limpios → ahora sí (sin espacios sobrantes, números convertidos).
12. El ZIP incluía `node_modules` → se excluye (`npm install` lo regenera); se agregó `.gitignore` con `.env` y la cartera de Oracle.

## 4. Decisiones por diferencias entre la app y la base de datos

No se modificó el script SQL. Donde la app pedía algo que la base no tiene, se resolvió así:

| Situación | Solución |
|---|---|
| `PEDIDO` no tiene columna para "Mesa 03 / Para llevar" | Se guarda al inicio de `OBSERVACIONES` como `[Mesa 03] nota` y se lee de vuelta |
| `USUARIO` no tiene correo | El login usa `NOMBRE_USUARIO` |
| `PEDIDO.ID_CLIENTE` es obligatorio | Se busca el cliente por nombre en `CLIENTE` y, si no existe, se crea |
| El combo (+$2.000) no existe en la base | Se guarda en `DETALLE_PEDIDO.PRECIO_UNITARIO` (precio + recargo); el servidor calcula el precio, nunca el navegador. El recargo está en `RECARGO_COMBO` (`orderService.js`) y en `catalogo-visual.json` |
| `SP_CREAR_PEDIDO` deja el pedido en `PENDIENTE` | La API lo pasa a `EN_PREPARACION` al enviarlo a cocina |
| "Plato" vs "Extra" no existe en la base | Plato = categoría `COMIDA`; el resto se muestra en "Extras" |
| El número de pedido ("#025") era inventado | Ahora se muestra el `ID_PEDIDO` real una vez guardado |

## 5. Qué se verificó realmente y qué no

**Ejecutado en este entorno**
- 20 pruebas automáticas de la API (`npm test`): login, permisos por rol, validaciones, reglas de stock, combos, seguimiento de pedidos, usuarios, hash de contraseñas, errores 503 sin filtrar datos, y que un texto con SQL malicioso nunca queda dentro del SQL. **Todas pasan.**
- Recorrido completo en un navegador real (Chromium) contra el backend: login (vacío, incorrecto y correcto), cajero, cocinero y administrador, productos (buscar, filtrar, crear, editar, duplicado, eliminar), pedido completo hasta la entrega, cierre de sesión. **Todo pasó.**
- Revisión de sintaxis de todos los `.js` y `.json`.

**NO verificado (no tuve acceso a Oracle ni a tus credenciales)**
- Ninguna consulta se ejecutó contra Oracle real: las pruebas usan una base simulada en memoria, que **no valida la sintaxis SQL**.
- Los puntos con más riesgo son: (a) el paso del tipo `T_LISTA_ITEMS` a `SP_CREAR_PEDIDO` (`db/oracle.js`, función `listaDe`), (b) la conexión con la cartera de Autonomous Database, y (c) los nombres de usuario/esquema (`ORACLE_SCHEMA`). Si el primer pedido falla, el error aparecerá en la consola del backend; revisa primero (a).
- `npm install` de `oracledb` no se pudo ejecutar aquí (sin internet); se declaró la dependencia `oracledb ^6.8.0` en `backend/package.json`.

**Pasos para validarlo en tu equipo:** `npm run probar-conexion` → `npm run crear-usuario` → `npm start` → entrar a la app y registrar un pedido; luego consulta en Oracle: `SELECT * FROM pedido; SELECT * FROM detalle_pedido;`.

## 6. Pendientes

- **Ventas** (`VENTA`: método de pago, cajero) y **reportes** (`REPORTE`): hay tablas pero la app aún no tiene pantallas ni endpoints.
- **Cancelar pedidos** (el estado `CANCELADO` existe en la base, falta el flujo).
- **Pantalla para administrar usuarios** (por ahora: `POST /api/usuarios` o `npm run crear-usuario`). Tampoco hay cambio ni restablecimiento de contraseña.
- `SP_CREAR_PEDIDO` no revisa el stock: la API lo revisa antes y la restricción `CHK_STOCK_PROD` protege al final, pero dos pedidos simultáneos del mismo último producto podrían competir (el segundo recibirá "stock insuficiente").
- El procedimiento hace `COMMIT` propio, así que crear el cliente, el pedido y pasar a "en preparación" no son una sola transacción; si lo último falla, el pedido queda `PENDIENTE` (la app también lo muestra como "En preparación").
- Un usuario desactivado conserva su sesión hasta que venza el token (2 h).
- No hay límite de intentos de login.
- Imágenes, emoji y rating dependen del nombre exacto del producto en `catalogo-visual.json`; un producto nuevo usa un emoji por categoría.
- Las pruebas contra Oracle real (por ejemplo con una base de pruebas) quedan pendientes.

## 3. Sprint 4 (tareas 27 a 30)

**Archivos nuevos** (backend): `services/` (`logger`, `auditService`, `feedbackService`, `monitorService`, `backupService`),
`middleware/` (`auditoria`, `rendimiento`), `routes/` (`auditoria`, `feedback`, `monitoreo`, `respaldos`), `validators/` (`auditoria`, `feedback`, `respaldo`),
`scripts/` (`crearTablas`, `respaldar`, `restaurar`, `pruebaCarga`), `sql/sprint4_tablas.sql`, `tests/sprint4.test.js`.
**Frontend nuevo:** `secciones/admin/` (pantalla de Administración) y `componentes/feedback.js`.

**Archivos que se modificaron:** `app.js` y `server.js` (rutas nuevas, respaldo automático, manejo de errores no capturados), `config/env.js` (variables nuevas),
`db/oracle.js` (una línea: tipo `texto` para leer CLOB), `middleware/auth.js` y `middleware/errores.js` (logs), las rutas `auth`, `productos`, `pedidos` y `usuarios`
(solo se agregó el middleware `auditar`), `validators/validar.js` (`validarConsulta`), `tests/dbFalsa.js` (tablas nuevas y rollback),
`nucleo/app.js`, `nucleo/estado.js`, `secciones/ajustes/ajustes.js`, `index.html`, `.gitignore`, `.env.example`, `package.json`, `README.md`.

**Base de datos:** 2 tablas nuevas (`AUDITORIA`, `FEEDBACK`) sin claves foráneas, a propósito: el historial debe sobrevivir aunque cambien usuarios o productos.
No se modificó ninguna tabla existente. Si falta crearlas, la API responde 503 con la instrucción `npm run crear-tablas` y el resto de la app sigue funcionando
(la auditoría nunca bloquea una operación).

**Qué NO está verificado:** las pruebas automáticas (47) usan la base falsa y comprueban la lógica, no el SQL contra Oracle real. Falta probar con tu Oracle:
`npm run crear-tablas`, `npm run respaldo` y una restauración de prueba. El SQL de la restauración (ajuste de columnas *identity*) depende de la versión de Oracle (12.2 o superior).

## 4. Tareas 31 a 34

**Backend nuevo:** `services/` (`eventosService`, `alertasService`, `clienteService`, `perfilService`, `limitador`, `pagoService`, `analiticaService`, `pagos/proveedorTransbank`, `pagos/proveedorSimulado`, `pagos/index`),
`routes/` (`notificaciones`, `clientes`, `perfil`, `pagos`, `analitica`), `validators/` (`cliente`, `perfil`, `pago`, `analitica`), `sql/tareas_31_34_tablas.sql`, `tests/tareas31a34.test.js`.
**Frontend nuevo:** `secciones/clientes/`, `componentes/notificaciones.js`, `componentes/cobro.js`, `componentes/perfil.js`.

**Archivos que se modificaron:** `app.js`, `server.js`, `config/env.js` (pagos), `routes/pedidos.js` y `routes/feedback.js` (avisos), `services/orderService.js` y `validators/orderValidator.js`
(cliente registrado y tipo de entrega *Despacho*), `services/backupService.js` (tablas nuevas y vaciado de las que el respaldo no tenía), `middleware/rendimiento.js`,
`scripts/crearTablas.js` y `scripts/probarConexion.js`, `tests/dbFalsa.js`, `.env.example`, `README.md`, y en el frontend `nucleo/` (`app`, `api`, `estado`, `utilidades`),
`componentes/navegacion.js`, `secciones/pedidos`, `secciones/ajustes`, `secciones/admin`, `index.html`.

**Base de datos:** 3 tablas nuevas (`CLIENTE_PERFIL`, `DIRECCION_DESPACHO`, `PAGO`) con claves foráneas a `CLIENTE` y `PEDIDO`, y un índice único que impide dos pagos autorizados del mismo pedido.
No se modificó ninguna tabla existente. El destino de despacho se guarda en `PEDIDO.OBSERVACIONES` (como ya se hacía con la mesa), limitado a 250 caracteres en total.

**Qué NO está verificado:** las pruebas automáticas (78 en total) usan la base falsa y un proveedor de pagos falso: comprueban la lógica, no el SQL contra Oracle real ni la comunicación con Webpay.
Falta probar con tu Oracle (`npm run crear-tablas`; el SQL usa `MERGE`, `NUMTODSINTERVAL` y un índice único basado en `CASE`) y con Webpay de integración.
El frontend se revisó solo a nivel de código (no se abrió en un navegador): conviene probar las pantallas nuevas en el celular, en especial el flujo de pago con la pestaña de Webpay.
Las notificaciones funcionan con la app abierta (no son "push" con la app cerrada, que exigiría HTTPS y un service worker).

