-- ==========================================================
-- DATOS INICIALES DEL MENÚ (Oracle)
-- Ejecutar después de crear las tablas con bajondemaite.sql,
-- conectado como el dueño del esquema (ADMIN).
-- Solo usa las columnas reales de la tabla PRODUCTO.
-- CATEGORIA permitida: COMIDA, BEBIDA, POSTRE, OTRO.
-- ==========================================================

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('La Doble Maite', 'Crujiente y dorado por fuera, sabroso por dentro. Incluye pastel de choclo casero + ensalada de tomate y cebolla a un precio irresistible.', 6990, 12, 'COMIDA');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Papas con todo', 'Papas fritas bañadas en cheddar y tocino crujiente.', 3990, 20, 'COMIDA');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Combo sin culpa', 'Doble Maite con papas fritas y bebida de 350 ml.', 8990, 3, 'COMIDA');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Alitas picantes', 'Alitas de pollo bañadas en salsa picante de la casa.', 4990, 0, 'COMIDA');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Bebidas', 'Bebida fría de 350 ml.', 1200, 60, 'BEBIDA');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Papas Fritas (medianas)', 'Papas fritas clásicas, porción mediana.', 1500, 18, 'OTRO');

INSERT INTO producto (nombre, descripcion, precio, stock, categoria)
VALUES ('Nuggets de pollo', 'Nuggets de pollo crujientes, 8 unidades.', 2100, 12, 'OTRO');

COMMIT;

-- Los usuarios NO se crean con SQL porque la contraseña se guarda con hash.
-- Crea el primer administrador desde la carpeta backend:
--   npm run crear-usuario -- "Nombre Apellido" usuario administrador
