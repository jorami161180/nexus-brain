import 'dotenv/config';
import { smartChat } from './router.js';
import { NexusOrchestrator } from '../orchestrator.ts';

/**
 * Nexus Control - Integration Test
 * Verifica la cadena completa: Input -> Orquestador -> LM Studio Agent
 */
async function runIntegrationTest() {
    console.log('🚀 Iniciando Test de Integración de Agentes...\n');

    const testCases = [
        { name: 'SALUDO', input: "Hola Nexus, ¿cómo estás hoy?", expected: 'writer' },
        { name: 'DESARROLLO', input: "Escribe una función en TypeScript para validar un email.", expected: 'developer' },
        { name: 'TESTING', input: "Encuentra el bug en este código: if(a = b) { return true }", expected: 'testing' },
        { name: 'INVESTIGACIÓN', input: "Busca las últimas novedades sobre Llama 4", expected: 'researcher' }
    ];

    for (const test of testCases) {
        console.log(`\n--- [PROBANDO: ${test.name}] ---`);
        console.log(`📥 Input: "${test.input}"`);

        // 1. Fase de Orquestación
        // Simulamos una decisión base para ver cómo el orquestador la refina
        const initialDecision = { agent: 'chat', confidence: 0.5, reasoning: 'Initial' };
        const refined = NexusOrchestrator.refine(test.input, initialDecision);

        console.log(`🎯 Agente elegido: ${refined.agent}`);
        console.log(`🧐 Lógica: ${refined.reasoning}`);

        // 2. Fase de Ejecución (Llamada real a LM Studio)
        try {
            console.log(`⏳ Llamando al modelo local (${refined.agent})...`);
            const start = Date.now();
            const result = await smartChat(refined.agent, "Eres un asistente técnico de Nexus Control.", test.input);
            const duration = (Date.now() - start) / 1000;

            console.log(`✅ Respuesta de: ${result.provider} / ${result.model}`);
            console.log(`⏱️  Tiempo de respuesta: ${duration}s`);
            console.log(`📄 Preview: "${result.text.slice(0, 150).replace(/\n/g, ' ')}..."`);
        } catch (err) {
            console.error(`❌ Error de conexión: ${err.message}`);
            console.log('👉 Asegúrate de que LM Studio esté corriendo en el puerto 1234 y los modelos estén cargados.');
        }
    }

    console.log('\n✨ Fin de las pruebas de integración.');
}

runIntegrationTest().catch(err => {
    console.error('💥 Error crítico en el test:', err);
});