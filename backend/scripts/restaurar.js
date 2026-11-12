/* ==========================================================
   RESTAURAR UN RESPALDO  →  npm run restaurar
   Sin argumentos lista los respaldos disponibles.

     npm run restaurar                                  (lista)
     npm run restaurar -- respaldo-20261110-153045.json

   REEMPLAZA los datos del negocio (productos, pedidos, usuarios,
   clientes...). Antes guarda un respaldo de seguridad y pide
   que escribas RESTAURAR para confirmar.
   ========================================================== */

import readline from 'node:readline';
import { validarConfig } from '../config/env.js';
import { db, iniciarPool, cerrarPool } from '../db/oracle.js';
import { listarRespaldos, restaurarRespaldo } from '../services/backupService.js';
import { registrarAuditoria } from '../services/auditService.js';


const archivo = process.argv[2];

function preguntar(texto) {
  return new Promise((resolver) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, (respuesta) => { rl.close(); resolver(respuesta.trim()); });
  });
}

try {
  if (!archivo) {
    const lista = await listarRespaldos();

    if (!lista.length) {
      console.log('Todavía no hay respaldos. Crea uno con: npm run respaldo');
    } else {
      console.log('Respaldos disponibles (el más nuevo primero):\n');
      for (const r of lista) console.log(`  ${r.archivo.padEnd(36)} ${r.tipo.padEnd(10)} ${Math.round(r.tamanoBytes / 1024)} KB`);
      console.log('\nPara restaurar uno:  npm run restaurar -- <nombre del archivo>');
    }
  } else {
    console.log(`Vas a REEMPLAZAR los datos actuales por los de ${archivo}.`);
    console.log('Antes se guardará un respaldo de seguridad del estado actual.\n');

    if ((await preguntar('Escribe RESTAURAR para continuar: ')) !== 'RESTAURAR') {
      console.log('Cancelado. No se cambió nada.');
    } else {
      validarConfig();
      await iniciarPool();

      const resultado = await restaurarRespaldo(db, archivo);

      console.log(`\nRestauración lista (respaldo del ${resultado.creado}).`);
      for (const [tabla, filas] of Object.entries(resultado.restauradas)) console.log(`  ${tabla.padEnd(15)} ${filas} registros`);
      console.log(`\nRespaldo de seguridad previo: ${resultado.respaldoDeSeguridad}`);
      for (const aviso of resultado.advertencias) console.log(`AVISO: ${aviso}`);

      await registrarAuditoria(db, {
        usuario: 'terminal', rol: 'sistema', accion: 'RESPALDO_RESTAURAR', entidad: 'RESPALDO', idEntidad: archivo,
        detalle: `Seguridad previa: ${resultado.respaldoDeSeguridad}`
      });
    }
  }
} catch (error) {
  console.error('No se pudo restaurar:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarPool();
}
