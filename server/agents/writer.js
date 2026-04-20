import { smartChat } from '../router.js';
import { syncToObsidian } from '../services/obsidiansync.js';

const TEMPLATES = {
// ... existing templates ...
  note: 'Escribe una nota estructurada en Markdown con título, resumen, contenido por secciones, puntos clave y tags sugeridos.',
  summary: 'Crea un resumen ejecutivo con TL;DR, puntos principales, conclusión y próximos pasos.',
  draft: 'Escribe un borrador completo con introducción, desarrollo con subsecciones y conclusión.',
  zettel: 'Crea una nota Zettelkasten con ID (YYYYMMDD), título conciso, idea central en 1 párrafo, conexiones y fuentes.',
  tweet_thread: 'Crea un hilo de tweets (máx 280 chars cada uno) con gancho, desarrollo y cierre con hashtags.',
  email: 'Redacta un email profesional con asunto, saludo, cuerpo conciso y cierre.'
};

const SYSTEM_PROMPT = `Eres el Agente Redactor del sistema Nexus Brain.
Genera contenido de alta calidad listo para Obsidian.

Responde en JSON:
{
  "content": "el contenido en Markdown",
  "word_count": número,
  "reading_time_min": número,
  "suggested_filename": "nombre-del-archivo.md",
  "tags": ["tag1", "tag2"],
  "obsidian_ready": true
}`;

export async function write({ type = 'note', topic, style = 'claro y conciso', context = '', sync = false }) {
  const template = TEMPLATES[type] || TEMPLATES.note;

  try {
    const { text, provider } = await smartChat(
      'writer',
      SYSTEM_PROMPT,
      `Tipo: ${type}\nTema: ${topic}\nEstilo: ${style}\n${context ? `Contexto: ${context}\n` : ''}\nFormato: ${template}`,
      2048
    );

    const json = text.match(/\{[\s\S]*\}/)?.[0];
    let parsedData = null;

    if (json) {
      try {
        parsedData = JSON.parse(json);
      } catch {
        parsedData = null;
      }
    }

    if (!parsedData) {
      // No vino JSON limpio — wrap el texto plano como respuesta válida
      parsedData = {
        content: text,
        answer: text, // para que /api/chat lo detecte correctamente
        word_count: text.split(' ').length,
        reading_time_min: Math.ceil(text.split(' ').length / 200),
        suggested_filename: `${topic?.toLowerCase().replace(/\s+/g, '-') || 'nota'}.md`,
        tags: [],
        obsidian_ready: true
      };
    }

    // Sincronización automática con Obsidian vía n8n (opcional — no bloquea si falla)
    let syncResult = null;
    if (sync) {
      try {
        syncResult = await syncToObsidian({
          title: parsedData.suggested_filename?.replace('.md', '') || topic,
          content: parsedData.content,
          folder: type === 'zettel' ? 'Zettelkasten' : 'Nexus/Generated',
          tags: (parsedData.tags || []).join(', ')
        });
      } catch (syncErr) {
        console.warn('[Writer] Sync con Obsidian fallido (n8n offline?):', syncErr.message);
        syncResult = { error: syncErr.message };
      }
    }

    return {
      success: true,
      data: parsedData,
      type,
      provider,
      sync: syncResult
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
