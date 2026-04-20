import { smartChat } from '../router.js';

const SYSTEM_PROMPT = `Eres el Agente Clasificador del sistema Nexus Brain.
Clasificas notas de forma LOCAL y PRIVADA.

Dado un texto, devuelve SIEMPRE JSON con:
{
  "category": "una categoría principal",
  "subcategory": "subcategoría opcional",
  "tags": ["tag1", "tag2", "tag3"],
  "priority": "alta | media | baja",
  "sentiment": "positivo | neutro | negativo",
  "complexity": "simple | moderado | complejo",
  "related_topics": ["tema1", "tema2"],
  "maturity": "borrador | en_progreso | maduro"
}`;

export async function classify(content, existingTags = []) {
  try {
    const { text, provider } = await smartChat(
      'classifier',
      SYSTEM_PROMPT,
      `${existingTags.length > 0 ? `Tags existentes: ${existingTags.join(', ')}\n\n` : ''}Clasifica este contenido:\n\n"${content}"`,
      512
    );

    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return { success: true, data: JSON.parse(json), source: provider };
  } catch {
    return { success: true, data: fallbackClassify(content), source: 'fallback' };
  }
}

function fallbackClassify(content) {
  const lower = content.toLowerCase();
  const tags = [];
  if (lower.includes('proyecto') || lower.includes('tarea')) tags.push('proyecto');
  if (lower.includes('idea') || lower.includes('concepto')) tags.push('idea');
  if (lower.includes('http') || lower.includes('enlace')) tags.push('recurso');
  return {
    category: tags[0] || 'general',
    subcategory: null,
    tags: tags.length > 0 ? tags : ['sin-clasificar'],
    priority: 'media', sentiment: 'neutro', complexity: 'simple',
    related_topics: [], maturity: 'borrador'
  };
}
