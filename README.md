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
├── componentes/                 navegación, cabecera, modal, detalle de producto
├── secciones/
│   ├── login/  inicio/  productos/  pedidos/  ajustes/
│   └── productos/catalogo-visual.json   emoji, foto y rating por nombre de producto (no existen en Oracle)
└── backend/
    ├── server.js  app.js        arranque y configuración de Express
    ├── config/env.js            lectura de .env
    ├── db/oracle.js             pool de conexiones Oracle
    ├── routes/                  auth, productos, pedidos, usuarios
    ├── services/                consultas SQL y reglas de negocio
    ├── validators/              validaciones Joi (las del equipo, ampliadas)
    ├── middleware/              JWT, roles y manejo de errores
    ├── scripts/                 probar-conexion y crear-usuario
    ├── sql/datos_iniciales.sql  menú inicial
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

## 10. Pruebas automáticas

```bash
cd backend && npm test
```

Usan una base de datos simulada en memoria (`tests/dbFalsa.js`): comprueban la lógica de la API, los permisos y las
validaciones, pero **no** reemplazan una prueba contra Oracle real (ver `INFORME_CAMBIOS.md`).
