console.log('--- TEST DE ARRANQUE ---');

try {
  console.log('1. Cargando Dotenv...');
  import('dotenv/config').then(() => {
    console.log('   OK.');
    
    console.log('2. Cargando Base de Datos (db.js)...');
    return import('./db.js');
  }).then((db) => {
    console.log('   OK. Registros en captures:', db.getStats().captures);
    
    console.log('3. Cargando Router (router.js)...');
    return import('./router.js');
  }).then(() => {
    console.log('   OK.');
    
    console.log('4. Cargando Orquestador...');
    return import('./agents/orchestrator.js');
  }).then(() => {
    console.log('--- TEST COMPLETADO CON ÉXITO ---');
    console.log('El problema NO es la carga de módulos. El error debe estar en el app.listen o en un conflicto de puerto.');
    process.exit(0);
  }).catch(err => {
    console.error('\n!!! ERROR DETECTADO !!!');
    console.error('Mensaje:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
} catch (e) {
  console.error('Error fatal síncrono:', e);
}
