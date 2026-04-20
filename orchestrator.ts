/**
 * Motor de Orquestación Optimizado para Nexus-control
 * Basado en el análisis de fallos de brain_trace.txt
 */
import * as fs from 'fs';
import * as path from 'path';

export interface OrchestratorDecision {
    agent: 'memory' | 'writer' | 'researcher' | 'projects' | 'capture' | 'chat' | 'developer' | 'architect' | 'testing';
    confidence: number;
    reasoning: string;
}

type CheckFunction = (input: string, modelDecision: OrchestratorDecision, context: RuleContext) => OrchestratorDecision | null;

interface OrchestrationRule {
    name: string;
    priority: number;
    check: CheckFunction;
}

interface RuleContext {
    normalizedInput: string;
    words: string[];
    hasCreationIntent: boolean;
}

export class NexusOrchestrator {
    private static rules: OrchestrationRule[] = [
        {
            name: 'REGLA_1_SALUDO',
            priority: 200,
            check: (input, _, ctx) => {
                const greetings = ['hola', 'buenos dias', 'que tal', 'saludos', 'como estas', 'hello', 'hi', 'morning', 'greetings'];
                if (greetings.some(g => ctx.normalizedInput.includes(g)) && ctx.normalizedInput.length < 35 && ctx.words.length < 6) {
                    return { agent: 'writer', confidence: 1.0, reasoning: '[REGLA_1_SALUDO] Saludo detectado. Redirigiendo a respuesta rápida.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_2_CREACION',
            priority: 190,
            check: (input, model, ctx) => {
                const creationVerbs = ['redacta', 'escribe', 'crea', 'hilo', 'post', 'genera', 'write', 'create'];
                const startsWithCreation = creationVerbs.some(verb => ctx.words.slice(0, 3).some(w => w.startsWith(verb)));
                if (startsWithCreation || (ctx.hasCreationIntent && model.agent === 'writer')) {
                    return { agent: 'writer', confidence: Math.max(model.confidence, 0.9), reasoning: '[REGLA_2_CREACION] Intención de creación confirmada. Ignorando sujetos de memoria.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_3_SAAS',
            priority: 180,
            check: (input, _, ctx) => {
                const keywords = ['saas', 'proyecto', 'idea de negocio', 'escalar', 'business idea', 'startup'];
                if (keywords.some(k => ctx.normalizedInput.includes(k))) {
                    return { agent: 'projects', confidence: 0.95, reasoning: '[REGLA_3_SAAS] Contexto de negocio/SaaS detectado.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_4_META',
            priority: 170,
            check: (input, _, ctx) => {
                const keywords = ['tardas', 'demoras', 'lento', 'por que no', 'contesta', 'slow', 'delay'];
                if (keywords.some(k => ctx.normalizedInput.includes(k))) {
                    return { agent: 'writer', confidence: 0.9, reasoning: '[REGLA_4_META] Respuesta a feedback sobre el funcionamiento/lentitud.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_5_SISTEMA',
            priority: 160,
            check: (input, _, ctx) => {
                const keywords = ['ayuda', 'puedes hacer', 'mision', 'quien eres', 'tu proposito', 'capaz de hacer', 'que haces', 'funciones'];
                if (keywords.some(k => ctx.normalizedInput.includes(k))) {
                    return { agent: 'writer', confidence: 1.0, reasoning: '[REGLA_5_SISTEMA] El usuario pregunta qué puedo hacer. Derivando a Writer para explicar capacidades.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_6_MEMORIA_CAPTURA',
            priority: 150,
            check: (input, model, ctx) => {
                const personal = ['mi gato', 'michi', 'mi nombre', 'favorita', 'quien soy', 'my cat', 'my name'];
                if (personal.some(k => ctx.normalizedInput.includes(k)) && !ctx.hasCreationIntent) {
                    const isQuestion = ctx.normalizedInput.includes('?') || ['como', 'cual', 'que', 'quien', 'how', 'what', 'who'].some(q => ctx.words[0].startsWith(q));

                    if (!isQuestion && ctx.words.length > 3) {
                        const entityRegex = /(?:mi gato|my cat|me llamo|my name is|soy|mi lenguaje favorito es)\s+([^.?!,;]+)/i;
                        const match = ctx.normalizedInput.match(entityRegex);
                        const entity = match ? match[1].trim() : 'nueva información';
                        return { agent: 'capture', confidence: 0.85, reasoning: `[REGLA_6_CAPTURA] El usuario está proporcionando información sobre: ${entity}` };
                    }

                    if (model.agent !== 'memory' && model.confidence < 0.8) {
                        return { agent: 'memory', confidence: 0.9, reasoning: '[REGLA_6_MEMORIA] Consulta de información personal detectada.' };
                    }
                }
                return null;
            }
        },
        {
            name: 'REGLA_7_ARCHIVOS',
            priority: 140,
            check: (input, _, ctx) => {
                const keywords = ['archivo', 'pdf', 'documento', 'adjunto', 'imagen', 'foto', 'file', 'attachment'];
                if (keywords.some(k => ctx.normalizedInput.includes(k)) && ['este', 'el', 'this', 'the'].some(art => ctx.normalizedInput.includes(art))) {
                    return { agent: 'researcher', confidence: 0.9, reasoning: '[REGLA_7_ARCHIVOS] Solicitud de análisis de archivos/adjuntos.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_8_RESUMEN',
            priority: 130,
            check: (input, _, ctx) => {
                const keywords = ['resume', 'resumen', 'summarize', 'tl;dr', 'haz un resumen'];
                if (keywords.some(k => ctx.normalizedInput.includes(k))) {
                    return { agent: 'writer', confidence: 1.0, reasoning: '[REGLA_8_RESUMEN] Solicitud de síntesis detectada.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_10_DESARROLLO',
            priority: 185,
            check: (input, _, ctx) => {
                const keywords = ['programa', 'codifica', 'rediseña', 'html', 'css', 'react', 'desarrolla', 'code', 'redesign'];
                if (keywords.some(k => ctx.normalizedInput.includes(k))) {
                    return { agent: 'developer', confidence: 0.95, reasoning: '[REGLA_10_DESARROLLO] Solicitud de desarrollo o rediseño técnico detectada.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_11_TESTING',
            priority: 186,
            check: (input, _, ctx) => {
                const keywords = ['test', 'prueba', 'jest', 'vitest', 'cypress', 'bug', 'error', 'verificar'];
                if (keywords.some(k => ctx.normalizedInput.includes(k)) && ctx.normalizedInput.length > 10) {
                    return { agent: 'testing', confidence: 0.95, reasoning: '[REGLA_11_TESTING] Solicitud de control de calidad o testing detectada.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_12_RAZONAMIENTO_COMPLEJO',
            priority: 195,
            check: (input, _, ctx) => {
                const complexKeywords = ['explica paso a paso', 'razona', 'matematicas', 'logica', 'por que ocurre', 'deduce', 'deep dive'];
                if (complexKeywords.some(k => ctx.normalizedInput.includes(k)) || ctx.normalizedInput.length > 150) {
                    return { agent: 'researcher', confidence: 0.98, reasoning: '[REGLA_12_RAZONAMIENTO] Tarea compleja detectada. Forzando DeepSeek R1 para razonamiento profundo.' };
                }
                return null;
            }
        },
        {
            name: 'REGLA_9_UMBRAL',
            priority: 10,
            check: (input, model, _) => {
                if (model.confidence > 0.95) return model;
                return null;
            }
        },
        {
            name: 'FALLBACK_BREVE',
            priority: 5,
            check: (input, model, ctx) => {
                if (model.agent === 'researcher' && ctx.words.length < 3) {
                    return { agent: 'writer', confidence: 0.8, reasoning: '[FALLBACK_BREVE] Entrada corta derivando a writer.' };
                }
                return null;
            }
        }
    ];

    /**
     * Refina la decisión del modelo aplicando una jerarquía de intenciones
     */
    public static refine(input: string, modelDecision: OrchestratorDecision): OrchestratorDecision {
        const normalizedInput = input.toLowerCase().trim();
        const words = normalizedInput.split(/\s+/);
        const hasCreationIntent = ['redacta', 'escribe', 'crea', 'write', 'create', 'hilo', 'post'].some(v => normalizedInput.includes(v));

        const context: RuleContext = { normalizedInput, words, hasCreationIntent };
        const sortedRules = [...NexusOrchestrator.rules].sort((a, b) => b.priority - a.priority);

        for (const rule of sortedRules) {
            const result = rule.check(input, modelDecision, context);
            if (result) return result;
        }
        return modelDecision;
    }

    /**
     * Persiste la decisión en el archivo de rastro para auditoría real-time.
     */
    public static persist(input: string, original: OrchestratorDecision, final: OrchestratorDecision): void {
        const logPath = 'c:/Users/joram/Nexus-control/brain_trace.txt';
        const timestamp = new Date().toISOString();

        const entry = `
[${timestamp}]
INPUT: "${input}"
ORQUESTADOR RECOMENDÓ: ${original.agent} (Conf: ${original.confidence})
AGENTE FINAL ELEGIDO: ${final.agent}
RAZONAMIENTO: ${final.reasoning}
--------------------------------------------------\n`;

        fs.appendFileSync(logPath, entry, 'utf8');
    }
}