import { smartChat, getEmbedding } from '../router.js';
import { saveMemoryQuery, searchMemoryFTS, searchSemantic, getProjects } from '../db.js';

const SYSTEM_PROMPT = `Eres el Agente Memoria del sistema Nexus Brain.
Responde preguntas basándote ÚNICAMENTE en el contexto de la base de conocimientos proporcionada.
Si la información no está en el contexto, indícalo claramente.

Devuelve JSON con:
{
  "answer": "respuesta detallada basada en el contexto",
  "sources": ["título de la nota 1", "nombre del proyecto X"],
  "confidence": 0.0-1.0,
  "gaps": ["qué información falta para una respuesta completa"],
  "connections": ["otras notas o temas relacionados que encontraste"],
  "follow_up": ["preguntas sugeridas para profundizar"]
} \nIMPORTANTE: No añadas Markdown extra, solo el JSON.`;

export async function query(question, additionalContext = []) {
  try {
    // 1. Obtener embedding de la pregunta
    const questionVector = await getEmbedding(question);

    // 2. Búsqueda Híbrida (Semántica + FTS5)
    let contextCaptures = [];
    if (questionVector) {
      console.log(`[MemoryAgent] Realizando búsqueda semántica para: "${question}"`);
      contextCaptures = searchSemantic(questionVector, 10);
    }

    // Complementar con FTS5 para asegurar palabras clave exactas
    const ftsResults = searchMemoryFTS(question, 10);
    const existingIds = new Set(contextCaptures.map(c => c.id));
    ftsResults.forEach(r => {
      if (!existingIds.has(r.id)) contextCaptures.push(r);
    });

    const recentProjects = getProjects(5);
    console.log(`[MemoryAgent] Contexto recuperado: ${contextCaptures.length} capturas, ${recentProjects.length} proyectos.`);

    const context = [
      ...contextCaptures.map(n => `--- NOTA RELEVANTE ENCONTRADA ---\nTítulo: ${n.title}\nTipo: ${n.type}\nContenido:\n${n.content || n.summary || '(Sin contenido)'}`),
      ...recentProjects.map(p => `--- PROYECTO RECIENTE ---\nNombre: ${p.name}\nStack: ${p.stack}\nDescripción: ${p.summary}`),
      ...(Array.isArray(additionalContext) ? additionalContext : [])
    ].join('\n\n');

    const promptBody = context && context.trim() !== ''
      ? `A continuación se muestra el conocimiento acumulado en Nexus Brain:\n\n${context}\n\nPregunta: "${question}"`
      : `No he encontrado información específica en mi base de datos para esta pregunta. Pregunta: "${question}"`;

    const { text } = await smartChat(
      'memory',
      SYSTEM_PROMPT,
      promptBody,
      1024
    );

    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const data = json ? JSON.parse(json) : { answer: text, sources: [], confidence: 0.5 };

    // Guardar la consulta en el historial de memoria
    try {
      saveMemoryQuery.run({
        question,
        answer: data.answer || text,
        confidence: data.confidence || 0.5,
        sources: JSON.stringify(data.sources || [])
      });
    } catch (dbErr) {
      console.error('Error guardando query de memoria:', dbErr.message);
    }

    return { success: true, data, contextSummary: `Indexadas ${contextCaptures.length} capturas y ${recentProjects.length} proyectos.` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
