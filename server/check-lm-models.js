import 'dotenv/config';
import OpenAI from 'openai';

const lmStudio = new OpenAI({
    baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
    apiKey: 'lm-studio'
});

async function listModels() {
    console.log('🔍 Conectando a LM Studio en:', lmStudio.baseURL);
    try {
        const response = await lmStudio.models.list();
        console.log('\n✅ Modelos detectados:');
        response.data.forEach((model, index) => {
            console.log(`${index + 1}. ID: ${model.id}`);
            console.log(`   Creado: ${new Date(model.created * 1000).toLocaleString()}`);
            console.log('   -----------------------------------');
        });
        console.log('\n💡 Copia el "ID" y pégalo en AGENT_MODELS dentro de server/router.js');
    } catch (err) {
        console.error('❌ Error: No se pudo conectar con LM Studio. Asegúrate de que el servidor esté encendido en el puerto 1234.');
    }
}

listModels();