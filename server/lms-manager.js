import { execSync } from 'child_process';

/**
 * Configuración de modelos necesarios para Nexus
 */
const REQUIRED_MODELS = [
    'google/gemma-3-4b',
    'text-embedding-nomic-embed-text-v1.5',
    'qwen/qwen2.5-coder-14b',
    'deepseek/deepseek-r1-0528-qwen3-8b'
];

export async function setupLMStudio() {
    console.log('🚀 Iniciando automatización de LM Studio...');

    try {
        // 1. Iniciar el servidor si no está corriendo
        console.log('📡 Asegurando que el servidor local esté activo...');
        try {
            execSync('lms server start', { stdio: 'inherit' });
        } catch (e) {
            // Si ya está iniciado, a veces lms devuelve un código de error, lo ignoramos
        }

        // 2. Cargar cada modelo
        for (const modelId of REQUIRED_MODELS) {
            console.log(`\n⏳ Procesando modelo: ${modelId}...`);
            try {
                // --gpu=max intenta cargar todas las capas en la GPU para máximo rendimiento
                execSync(`lms load ${modelId} --gpu=max`, { stdio: 'inherit' });
            } catch (err) {
                console.log(`⚠️  El modelo no se pudo cargar (¿no descargado?). Intentando descargar...`);
                try {
                    // El comando download busca el modelo en el hub de LM Studio y lo baja
                    execSync(`lms download ${modelId}`, { stdio: 'inherit' });
                    console.log(`📡 Descarga completada. Reintentando carga...`);
                    execSync(`lms load ${modelId} --gpu=max`, { stdio: 'inherit' });
                } catch (downloadErr) {
                    console.error(`❌ Error crítico con ${modelId}: no se pudo descargar ni cargar.`, downloadErr.message);
                    continue;
                }
            }
            console.log(`✅ ${modelId} listo.`);
        }

        console.log('\n✨ Todos los modelos han sido procesados.');
        execSync('lms status', { stdio: 'inherit' });

    } catch (error) {
        console.error('❌ Error crítico en lms-manager:', error.message);
        console.log('👉 Asegúrate de que LM Studio esté abierto y la CLI "lms" esté instalada en el PATH.');
    }
}

// Si se ejecuta directamente
if (import.meta.url.endsWith('lms-manager.js')) {
    setupLMStudio();
}