/* ==========================================================
   CREAR UN USUARIO DESDE LA TERMINAL
   Sirve para crear el primer administrador (la base de datos
   queda sin usuarios al importar el script).

     npm run crear-usuario -- "Maite López" maite administrador

   La contraseña se pide por pantalla (no queda en el historial).
   ========================================================== */

import readline from 'node:readline';
import { validarConfig } from '../config/env.js';
import { db, iniciarPool, cerrarPool } from '../db/oracle.js';
import { crearUsuario } from '../services/userService.js';


const [nombre, usuario, rol] = process.argv.slice(2);

if (!nombre || !usuario || !['administrador', 'cajero', 'cocinero'].includes(rol)) {
  console.error('Uso: npm run crear-usuario -- "Nombre Apellido" usuario administrador|cajero|cocinero');
  process.exit(1);
}

function pedirClave() {
  return new Promise((resolver) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (texto) => { if (texto.includes('Contraseña')) process.stdout.write(texto); }; // oculta lo que se escribe
    rl.question('Contraseña (mín. 8, con letras y números): ', (clave) => { rl.close(); console.log(); resolver(clave); });
  });
}

try {
  const password = process.env.NUEVA_CLAVE || await pedirClave();

  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('La contraseña debe tener al menos 8 caracteres, con letras y números.');
  }

  validarConfig();
  await iniciarPool();

  const creado = await crearUsuario(db, { nombre, usuario, password, rol });
  console.log(`Usuario creado: ${creado.usuario} (${creado.rol}) con id ${creado.id}`);
} catch (error) {
  console.error('No se pudo crear el usuario:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
