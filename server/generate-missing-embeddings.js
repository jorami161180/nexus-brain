import 'dotenv/config'; // Carga las variables de entorno
import { getEmbedding, isModelLoaded } from './router.js';
import { db, updateCaptureEmbedding } from './db.js';

async function generateMissingEmbeddings() {
    console.log('🔍 Iniciando generación de embeddings para notas antiguas...');

    try {
        // 1. Verificación previa del modelo
        const EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5";
        const isLoaded = await isModelLoaded(EMBED_MODEL);

        if (!isLoaded) {
            console.error(`❌ ERROR: El modelo "${EMBED_MODEL}" no está cargado en LM Studio.`);
            console.log('👉 Abre LM Studio, busca el modelo y asegúrate de que el servidor local esté activo.');
            return;
        }

        // Obtener todas las capturas que no tienen embedding
        const capturesWithoutEmbedding = db.prepare('SELECT id, title, summary, content FROM captures WHERE embedding IS NULL').all();

        if (capturesWithoutEmbedding.length === 0) {
            console.log('✅ No se encontraron notas sin embeddings. ¡Todo listo!');
            return;
        }

        console.log(`⏳ Se encontraron ${capturesWithoutEmbedding.length} notas sin embeddings. Procesando...`);

        let processedCount = 0;
        for (const capture of capturesWithoutEmbedding) {
            const textToEmbed = `${capture.title || ''} ${capture.summary || ''} ${capture.content || ''}`.trim();

            if (textToEmbed.length > 0) {
                console.log(`   Generando embedding para captura ID: ${capture.id} - "${capture.title?.slice(0, 50)}..."`);
                const embedding = await getEmbedding(textToEmbed);

                if (embedding) {
                    updateCaptureEmbedding.run({ id: capture.id, embedding: JSON.stringify(embedding) });
                    processedCount++;
                    console.log(`   ✅ Embedding generado y guardado para ID: ${capture.id}`);
                } else {
                    console.warn(`   ⚠️ No se pudo generar embedding para ID: ${capture.id}. Posiblemente LM Studio no está activo.`);
                }
            } else {
                console.warn(`   Skipping ID: ${capture.id} - Contenido vacío para embedding.`);
            }
        }

        console.log(`\n🎉 Proceso completado. Se generaron y guardaron ${processedCount} nuevos embeddings.`);
    } catch (error) {
        console.error('❌ Error durante la generación de embeddings:', error);
        console.error('Asegúrate de que LM Studio esté corriendo y el modelo "text-embedding-nomic-embed-text-v1.5" esté cargado.');
    } finally {
        db.close(); // Cierra la conexión a la base de datos
    }
}

generateMissingEmbeddings();