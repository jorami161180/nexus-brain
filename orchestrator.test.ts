import { NexusOrchestrator, OrchestratorDecision } from './orchestrator';

describe('NexusOrchestrator Validations', () => {
    test('Debe priorizar WRITER en el caso del hilo de Twitter con Michi', () => {
        const input = "Redacta.Un hilo.De Twitter.Impactante.¿Sobre cómo he construido?Mi propio cerebro digital.Usando modelos locales.Mencionando que mi gato michi es el primer beta tester.";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.9, reasoning: 'Model original' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('writer');
        expect(result.reasoning).toContain('Intención de creación confirmada');
    });

    test('Debe detectar creación incluso después de un saludo', () => {
        const input = "Hola, redacta un post corto.";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.8, reasoning: 'Model original' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('writer');
        expect(result.reasoning).toContain('[REGLA_2_CREACION]');
    });

    test('Debe redirigir saludos simples a WRITER y no a Researcher o Memory', () => {
        const inputs = ["hola", "hola como estas", "te estoy saLUDANDO", "buenos dias"];

        inputs.forEach(input => {
            const modelDecision: OrchestratorDecision = { agent: 'researcher', confidence: 0.7, reasoning: 'Model confused' };
            const result = NexusOrchestrator.refine(input, modelDecision);
            expect(result.agent).toBe('writer');
            expect(result.reasoning).toContain('[REGLA_1_SALUDO]');
        });
    });

    test('Debe forzar PROJECTS para ideas de SaaS', () => {
        const input = "dame una idea de un proyecto saas que pueda escalar";
        const modelDecision: OrchestratorDecision = { agent: 'researcher', confidence: 0.8, reasoning: 'Model original' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('projects');
        expect(result.confidence).toBe(0.95);
        expect(result.reasoning).toContain('[REGLA_3_SAAS]');
    });

    test('Debe mantener MEMORY para consultas directas sobre el gato', () => {
        const input = "¿Cuál es la comida favorita de michi?";
        const modelDecision: OrchestratorDecision = { agent: 'memory', confidence: 0.8, reasoning: 'Model correct' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('memory');
    });

    test('Debe capturar preguntas sobre la identidad del usuario en MEMORY', () => {
        const input = "Dime quien soy";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.5, reasoning: 'Low confidence' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('memory');
        expect(result.reasoning).toContain('[REGLA_6_MEMORIA]');
    });

    test('Debe tratar temas de "misterio" como consultas de memoria si la confianza es baja', () => {
        const input = "CUAL ES EL MISTERIO";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.6, reasoning: 'Unsure' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('memory');
        expect(result.reasoning).toContain('[REGLA_6_MEMORIA]');
    });

    test('Debe detectar CAPTURE para afirmaciones personales sin preguntas', () => {
        const input = "mi gato michi es negro";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.5, reasoning: 'Low confidence' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('capture');
        expect(result.reasoning).toContain('[REGLA_6_CAPTURA]');
    });

    test('Debe dirigir preguntas sobre el sistema a MEMORY', () => {
        const input = "¿En qué me puedes ayudar?";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.6, reasoning: 'Unsure' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('memory');
        expect(result.reasoning).toContain('[REGLA_5_SISTEMA]');
    });

    test('Debe manejar quejas sobre lentitud con WRITER', () => {
        const input = "PORQUE TARDAS TANTO";
        const modelDecision: OrchestratorDecision = { agent: 'researcher', confidence: 0.4, reasoning: 'Model lost' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('writer');
        expect(result.reasoning).toContain('[REGLA_4_META]');
    });

    test('Debe detectar solicitudes de procesamiento de ARCHIVOS', () => {
        const input = "Analiza este archivo PDF por favor";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.5, reasoning: 'Low confidence' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('researcher');
        expect(result.reasoning).toContain('[REGLA_7_ARCHIVOS]');
    });

    test('Debe funcionar con comandos en INGLÉS (Multi-idioma)', () => {
        const input = "Write a thread about AI";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.8, reasoning: 'Model original' };

        const result = NexusOrchestrator.refine(input, modelDecision);
        expect(result.agent).toBe('writer');
        expect(result.reasoning).toContain('[REGLA_2_CREACION]');
    });

    test('Debe extraer el nombre de la ENTIDAD en la captura', () => {
        const input = "my cat michi is very fast";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.5, reasoning: 'Low confidence' };

        const result = NexusOrchestrator.refine(input, modelDecision);
        expect(result.agent).toBe('capture');
        expect(result.reasoning).toContain('michi');
    });

    test('Debe detectar CAPTURE para información técnica compleja (Caso Groq)', () => {
        const input = "He descubierto que las LPU de Groq son mucho más rápidas que las GPUs tradicionales para la inferencia.";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.6, reasoning: 'Model unsure' };

        const result = NexusOrchestrator.refine(input, modelDecision);
        expect(result.agent).toBe('capture');
        expect(result.reasoning).toContain('[REGLA_6_CAPTURA]');
    });

    test('Debe extraer la entidad del setup en una captura en inglés', () => {
        const input = "my new setup is based on a Mac Studio with M2 Ultra";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.5, reasoning: 'Low confidence' };

        const result = NexusOrchestrator.refine(input, modelDecision);
        expect(result.agent).toBe('capture');
        expect(result.reasoning).toContain('Mac Studio');
    });

    test('Debe detectar solicitudes de RESUMEN', () => {
        const input = "Hazme un resumen de nuestra conversación sobre Groq";
        const modelDecision: OrchestratorDecision = { agent: 'writer', confidence: 0.7, reasoning: 'Unsure' };

        const result = NexusOrchestrator.refine(input, modelDecision);
        expect(result.agent).toBe('writer');
        expect(result.reasoning).toContain('[REGLA_8_RESUMEN]');
    });

    test('Debe detectar solicitudes de TESTING y derivar al agente correcto', () => {
        const input = "Necesito que verifiques si hay un error en este componente y generes un test con vitest.";
        const modelDecision: OrchestratorDecision = { agent: 'developer', confidence: 0.7, reasoning: 'Model unsure' };

        const result = NexusOrchestrator.refine(input, modelDecision);

        expect(result.agent).toBe('testing');
        expect(result.confidence).toBe(0.95);
        expect(result.reasoning).toContain('[REGLA_11_TESTING]');
    });
});