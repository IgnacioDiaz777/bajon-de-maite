# El bajón de Maite — App conectada a Oracle

Frontend (HTML + CSS + JavaScript, una carpeta por sección) + backend (Node.js + Express) + base de datos **Oracle SQL**.

```
Navegador (frontend)  ──HTTP/JSON──►  Backend Express (puerto 3000)  ──node-oracledb──►  Oracle
```

El navegador **nunca** habla directo con Oracle: el backend valida, controla los permisos por rol y ejecuta
las consultas con parámetros (`:nombre`), sin concatenar datos del usuario.

---

## 1. Requisitos

- Node.js **20 o superior** (`node -v`)
- Acceso a tu base de datos Oracle (usuario, contraseña y cadena de conexión; si es Autonomous Database, la cartera/wallet)
- VS Code con la extensión *Live Server* (el proyecto ya viene configurado en el puerto 5502) o Python para servir el frontend

## 2. Preparar la base de datos (una sola vez)

1. Ejecuta `bajondemaite.sql` (el script de tu equipo) para crear las tablas, el tipo `T_LISTA_ITEMS`, el trigger y `SP_CREAR_PEDIDO`.
2. Ejecuta `backend/sql/datos_iniciales.sql` para cargar el menú (el script original crea las tablas vacías).

## 3. Configurar el backend

```bash
cd backend
npm install
cp .env.example .env        # en Windows: copy .env.example .env
```

Abre `backend/.env` y completa **tus** datos (el archivo `.env` no se sube a Git):

| Variable | Qué poner |
|---|---|
| `JWT_SECRET` | Texto aleatorio de 32+ caracteres. Genera uno: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ORACLE_USER` / `ORACLE_PASSWORD` | Usuario y contraseña de Oracle |
| `ORACLE_CONNECT_STRING` | Alias del `tnsnames.ora` (ej. `minombre_high`) o `host:1521/servicio` |
| `ORACLE_WALLET_DIR` / `ORACLE_WALLET_PASSWORD` | Solo con Autonomous Database: carpeta de la cartera descomprimida y su contraseña |
| `ORACLE_SCHEMA` | `ADMIN` (esquema dueño de las tablas según el script) |

## 4. Probar la conexión

```bash
npm run probar-conexion
```

Debe mostrar `OK` en las 10 tablas y en `SP_CREAR_PEDIDO`. Si falla, el mensaje indica qué revisar
(usuario/clave, cadena de conexión, cartera o esquema).

## 5. Crear el primer administrador

Los usuarios guardan la contraseña con hash, por eso no se crean con SQL. Desde `backend`:

```bash
npm run crear-usuario -- "Maite López" maite administrador
```

(pide la contraseña por pantalla; mínimo 8 caracteres con letras y números). Roles: `administrador`, `cajero`, `cocinero`.
Más usuarios: el administrador puede usar `POST /api/usuarios` o repetir este comando.

## 6. Ejecutar

```bash
cd backend
npm start                   # API en http://localhost:3000
```

Luego abre `index.html` con *Live Server* (puerto 5502), o desde la carpeta raíz del proyecto:

```bash
python -m http.server 8000  # http://localhost:8000
```

> Si sirves el frontend en otro puerto, agrégalo a `CORS_ORIGENES` en `backend/.env`.
> Si el backend no corre en `localhost:3000`, cambia `API_URL` en `nucleo/config.js`.

## 7. Roles y permisos

| Acción | Administrador | Cajero | Cocinero |
|---|:-:|:-:|:-:|
| Ver menú y pedidos en cocina | ✔ | ✔ | ✔ |
| Crear / editar / eliminar productos | ✔ | | |
| Registrar pedidos | ✔ | ✔ | |
| Marcar pedido "listo" | ✔ | | ✔ |
| Marcar pedido "entregado" | ✔ | ✔ | |
| Registrar usuarios | ✔ | | |

## 8. Estructura

```
bajon-de-maite/
├── index.html
├── assets/img/                  fotos de los productos
├── nucleo/                      arranque y rutas (app.js), estado, cliente de la API (api.js), config.js
├── componentes/                 navegación, cabecera, modal, detalle de producto, feedback, notificaciones, cobro, perfil
├── secciones/
│   ├── login/  inicio/  productos/  pedidos/  ajustes/  admin/  clientes/
│   └── productos/catalogo-visual.json   emoji, foto y rating por nombre de producto (no existen en Oracle)
└── backend/
    ├── server.js  app.js        arranque y configuración de Express
    ├── config/env.js            lectura de .env
    ├── db/oracle.js             pool de conexiones Oracle
    ├── routes/                  auth, productos, pedidos, usuarios
    ├── services/                consultas SQL y reglas de negocio
    ├── validators/              validaciones Joi (las del equipo, ampliadas)
    ├── middleware/              JWT, roles, errores, auditoría y medición de rendimiento
    ├── scripts/                 probar-conexion, crear-usuario, crear-tablas, respaldar, restaurar, prueba-carga
    ├── sql/                     datos_iniciales.sql (menú) y sprint4_tablas.sql (AUDITORIA y FEEDBACK)
    └── tests/                   pruebas automáticas
```

## 9. API

| Método y ruta | Rol | Tabla(s) |
|---|---|---|
| `GET /api/salud` | público | (consulta `dual`) |
| `POST /api/auth/login` | público | USUARIO, ADMINISTRADOR, CAJERO, COCINERO |
| `GET /api/productos` | todos | PRODUCTO |
| `POST /api/productos`, `PUT /api/productos/:id`, `DELETE /api/productos/:id` | administrador | PRODUCTO |
| `GET /api/pedidos` | todos | PEDIDO, DETALLE_PEDIDO, CLIENTE, PRODUCTO |
| `POST /api/pedidos` | administrador, cajero | CLIENTE, `SP_CREAR_PEDIDO` (PEDIDO, DETALLE_PEDIDO, PRODUCTO) |
| `POST /api/pedidos/:id/avanzar` | según estado | PEDIDO |
| `GET/POST /api/usuarios` | administrador | USUARIO + tabla del rol |
| `GET /api/monitoreo`, `POST /api/monitoreo/reiniciar` | administrador | (memoria del servidor + `dual`) |
| `GET /api/auditoria` (filtros: usuario, accion, resultado, desde, hasta, limite) | administrador | AUDITORIA |
| `POST /api/feedback` | todos | FEEDBACK |
| `GET /api/feedback` | todos (cada uno ve lo suyo; el administrador, todo) | FEEDBACK |
| `PATCH /api/feedback/:id/estado` | administrador | FEEDBACK |
| `GET/POST /api/respaldos`, `POST /api/respaldos/restaurar` | administrador | todas las tablas |
| `GET /api/notificaciones`, `GET /api/notificaciones/flujo` (tiempo real) | todos (cada rol ve sus avisos) | memoria del servidor |
| `POST /api/pagos/efectivo`, `POST /api/pagos/tarjeta`, `GET /api/pagos?pedidos=1,2` | administrador, cajero | PAGO, PEDIDO |
| `GET/POST /api/pagos/retorno` | pública (vuelta de Webpay; se valida con Transbank) | PAGO |
| `POST /api/pagos/:id/anular`, `GET /api/pagos/historial` | administrador | PAGO |
| `GET/POST/PUT /api/clientes`, `/api/clientes/:id/direcciones` | administrador, cajero | CLIENTE, CLIENTE_PERFIL, DIRECCION_DESPACHO |
| `DELETE /api/clientes/:id` | administrador | CLIENTE |
| `GET/PUT /api/perfil`, `PUT /api/perfil/clave` | todos (solo su propio usuario) | USUARIO |
| `GET /api/analitica/ventas` | administrador | PEDIDO, DETALLE_PEDIDO, PRODUCTO, PAGO |

## 10. Sprint 4: monitoreo, feedback, auditoría y respaldo

Una sola vez, crea las dos tablas nuevas (`AUDITORIA` y `FEEDBACK`) desde la carpeta `backend`:

```bash
npm run crear-tablas        # ejecuta backend/sql/sprint4_tablas.sql (se puede repetir sin problema)
```

Luego, como administrador, entra a **Ajustes → Administración** (pestañas Rendimiento, Auditoría, Reportes y Respaldos).
Cualquier rol puede enviar comentarios y fallos desde **Ajustes → Comentarios y reporte de fallos**.

| Tarea | Qué hace | Dónde |
|---|---|---|
| **#27 Monitoreo de rendimiento** | Mide en memoria el tiempo de cada ruta (promedio, p95, máximo, errores), la latencia de Oracle, memoria y solicitudes por minuto. Las solicitudes más lentas que `MONITOREO_UMBRAL_MS` se anotan en los logs. | `GET /api/monitoreo`, pestaña *Rendimiento*, `npm run prueba-carga` |
| **#28 Feedback y reporte de fallos** | Comentarios, sugerencias y fallos con gravedad; los errores de JavaScript de la pantalla se reportan solos (con límites). El administrador cambia el estado: abierto → en revisión → resuelto. | tabla `FEEDBACK`, `/api/feedback`, pestaña *Reportes* |
| **#29 Auditoría y logs de transacciones** | Cada login (correcto o fallido), cambio de productos, pedidos, usuarios y respaldos queda con quién, qué, cuándo, IP y resultado. También se escribe `backend/logs/app-AAAA-MM-DD.log` (una línea JSON por evento). Nunca se guardan contraseñas. | tabla `AUDITORIA`, `GET /api/auditoria`, pestaña *Auditoría* |
| **#30 Respaldo y restauración** | Respaldo automático de las tablas a `backend/respaldos/*.json` (con huella SHA-256), rotación de los últimos N y restauración en una sola transacción, con respaldo de seguridad previo. | `/api/respaldos`, pestaña *Respaldos*, `npm run respaldo`, `npm run restaurar` |

**Prueba de carga** (solo lee, no escribe; el servidor debe estar encendido):

```bash
npm run prueba-carga -- --usuario maite --solicitudes 300 --concurrencia 20
```

**Respaldos por terminal:**

```bash
npm run respaldo                                     # crea uno ahora
npm run restaurar                                    # lista los respaldos
npm run restaurar -- respaldo-20261110-153045.json   # restaura (pide escribir RESTAURAR)
```

Variables opcionales de `backend/.env` (ver `.env.example`): `RESPALDO_CADA_HORAS` (24; `0` lo desactiva), `RESPALDO_MAX` (7),
`MONITOREO_UMBRAL_MS` (1000), `LOG_DIAS` (30), `LOG_ARCHIVO=0` (sin archivos de log).

> **Importante sobre la restauración:** reemplaza las tablas del negocio (usuarios, clientes, productos, pedidos, detalle, venta, reporte).
> `AUDITORIA` y `FEEDBACK` se respaldan pero **nunca se pisan**. Es un respaldo *lógico* de la aplicación: no reemplaza el respaldo físico de Oracle.
> No soporta columnas BLOB/RAW. Pruébalo primero con datos de prueba, no con los definitivos.

## 11. Tareas 31 a 34: alertas, pagos, clientes y ventas

Una vez, desde la carpeta `backend`, crea las tablas nuevas (`CLIENTE_PERFIL`, `DIRECCION_DESPACHO` y `PAGO`; se puede repetir sin problema):

```bash
npm run crear-tablas
```

| Tarea | Qué hace | Dónde |
|---|---|---|
| **#31 Notificaciones y alertas en tiempo real** | El navegador abre una conexión permanente (Server-Sent Events) y recibe al instante: pedido nuevo (cocina), pedido listo (caja), stock bajo o agotado, pago aprobado/anulado y fallos graves (administrador). Mensaje flotante, sonido, aviso del navegador con la pestaña en segundo plano y lista en el botón **Avisos**. Si se corta, reconecta sola y recupera lo perdido. | `/api/notificaciones`, botón *Avisos*, Ajustes → Alertas |
| **#32 Pasarela de pagos** | Cobro en **efectivo** (con vuelto) o con **tarjeta por Webpay Plus** (Transbank). El monto sale siempre del pedido en Oracle, un pago se confirma una sola vez, si la pasarela cobra otro monto se reembolsa, un pedido no puede quedar pagado dos veces y los pagos que quedan a medias se concilian solos. No se guardan datos de tarjeta (solo los últimos 4 dígitos). El administrador puede anular y reembolsar. | `/api/pagos`, botón *Cobrar* en Pedidos, Administración → Pagos |
| **#33 Perfiles y direcciones de despacho** | Clientes con teléfono, correo y notas; hasta 5 direcciones por cliente (una principal). Un pedido puede ser **Despacho** a una dirección del cliente. Cada usuario cambia su nombre y su contraseña en *Mi perfil*. | `/api/clientes`, `/api/perfil`, Ajustes → Clientes y direcciones |
| **#34 Panel de ventas** | Ventas totales, pedidos, ticket promedio, ventas por día, productos más vendidos, categorías, tipo de entrega, horas con más pedidos y cobros por método (con lo que falta por cobrar). Una "venta" es un pedido no cancelado. | `GET /api/analitica/ventas`, Administración → Ventas |

### Pagos: de pruebas a producción

La variable `PAGOS_PROVEEDOR` de `backend/.env` decide cómo se cobra con tarjeta:

| Modo | Variables | Para qué sirve |
|---|---|---|
| `simulado` (por defecto) | ninguna | Una pantalla de pago falsa (Aprobar / Rechazar / Cancelar) para desarrollar y probar sin cuenta. **No se puede usar en producción**: el servidor no arranca. |
| `transbank` + `TBK_AMBIENTE=integracion` | ninguna (usa las credenciales públicas de prueba de Transbank) | Webpay real de pruebas: tarjetas de prueba, sin dinero. |
| `transbank` + `TBK_AMBIENTE=produccion` | `TBK_COMMERCE_CODE`, `TBK_API_KEY`, `BACKEND_PUBLIC_URL` con `https://` | Dinero real. |

Además: `FRONTEND_URL` (a dónde vuelve el cliente después de pagar) y `BACKEND_PUBLIC_URL` (a dónde lo devuelve Webpay).
Para salir a producción faltan trámites que no se pueden hacer desde el código: Transbank valida el comercio y entrega las credenciales
reales, y el backend debe estar publicado con HTTPS. Webpay Plus no tiene "webhooks": confirma cuando el cliente vuelve al sitio, por eso existe la conciliación automática.

**Qué probar con Webpay de integración (antes de producción):** pago aprobado, pago rechazado, cancelar en la pantalla de Webpay, cerrar la pestaña sin pagar, anular un pago y pagar dos veces el mismo pedido.

## 12. Pruebas automáticas

```bash
cd backend && npm test
```

Usan una base de datos simulada en memoria (`tests/dbFalsa.js`): comprueban la lógica de la API, los permisos y las
validaciones, pero **no** reemplazan una prueba contra Oracle real (ver `INFORME_CAMBIOS.md`).
