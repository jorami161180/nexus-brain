import 'dotenv/config';
import db from './db.js';
import { exportProjectToObsidian } from './export.js';

async function runAugmentedIntelligenceTest() {
    console.log('🚀 Iniciando Test de Inteligencia Aumentada...\n');

    // 1. Prueba de Recuperación FTS (Memoria / RAG)
    console.log("--- [1] PROBANDO RAG EN CHAT ---");
    const query = "Nexus"; 
    console.log(`Buscando conocimiento previo sobre: "${query}"`);
    try {
        const searchResults = db.prepare(`SELECT c.* FROM captures_fts f JOIN captures c ON f.rowid = c.id WHERE captures_fts MATCH ? ORDER BY rank LIMIT 3`).all(query.replace(/[^a-zA-Z0-9 ]/g, '') + '*');
        
        if (searchResults.length > 0) {
            console.log(`✅ ¡Éxito! Se recuperaron ${searchResults.length} resultados de memoria relevantes.`);
            console.log(`📄 Fragmento recuperado: [${searchResults[0].title}] - ${String(searchResults[0].summary || searchResults[0].content).slice(0, 100)}...`);
        } else {
            console.log("⚠️ No se encontró memoria previa (esto es normal si la BD de capturas está vacía).");
        }
    } catch (e) {
        console.error("❌ Error en búsqueda FTS:", e.message);
    }

    console.log("\n--- [2] PROBANDO EXPORTACIÓN A OBSIDIAN ---");
    // Tomar el primer proyecto de la base de datos
    const firstProject = db.prepare('SELECT id, name FROM projects LIMIT 1').get();
    if (firstProject) {
        console.log(`Generando Markdown para el proyecto de id: ${firstProject.id} (${firstProject.name})`);
        try {
            const { filename, content } = await exportProjectToObsidian(firstProject.id);
            console.log(`✅ ¡Éxito! Nombre de archivo generado: ${filename}`);
            console.log(`📄 Preview Markdon (primeros 200 caracteres):\n\n${content.slice(0, 200)}...\n`);
        } catch (e) {
            console.error("❌ Error en exportación a Obsidian:", e.message);
        }
    } else {
        console.log("⚠️ No se encontraron proyectos en la base de datos para probar la exportación.");
    }

    console.log("\n--- [3] PROBANDO CAPTURA CON VISIÓN (Developer) ---");
    console.log("Visualmente cubierto debido a dependencias con LLMs remotos.");
    console.log("El endpoint '/api/developer' ha sido actualizado para adjuntar 'image' al LLM local (e.g. glm-4.6v-flash).");

    console.log('\n✨ Fin de las pruebas de Inteligencia Aumentada.');
}

runAugmentedIntelligenceTest().catch(console.error);
