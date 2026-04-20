import { lm, MODELS } from '../lmstudio.js';
import { smartChat } from '../router.js';
import { saveCapture } from '../db.js';
import axios from 'axios';

const SYSTEM_PROMPT = `Eres el Agente Captura del sistema Nexus Brain.
Procesa información nueva y estructúrala para el cerebro digital.

Devuelve SIEMPRE JSON con:
{
  "title": "título conciso",
  "summary": "resumen de 2-3 líneas",
  "key_points": ["punto 1", "punto 2"],
  "type": "idea | article | resource | note | task | reference",
  "suggested_tags": ["tag1", "tag2"],
  "connections": ["posibles conexiones con otros temas"],
  "action_required": true/false,
  "raw_content": "contenido original procesado"
}`;

export async function capture({ type, content, url, imageBase64, embedding }) {
  if (type === 'url' && url) {
    try {
      const { data } = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 NexusBrain/2.0' } });
      const text = data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 4000);
      content = `URL: ${url}\n\nContenido:\n${text}`;
    } catch {
      content = `URL: ${url} (no se pudo obtener el contenido)`;
    }
  }

  // Imagen — usa GLM vision directamente (único con capacidad multimodal)
  if (type === 'image' && imageBase64) {
    try {
      const response = await lm.chat.completions.create({
        model: MODELS.capture,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user', content: [
              { type: 'text', text: 'Analiza esta imagen y estructura la información:' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
            ]
          }
        ]
      });
      return parseResult(response.choices[0].message.content, embedding);
    } catch (err) {
      return { success: false, error: `Error procesando imagen: ${err.message}` };
    }
  }

  const { text } = await smartChat(
    'capture',
    SYSTEM_PROMPT,
    `Estructura este contenido para mi cerebro digital. Responde ÚNICAMENTE con el objeto JSON, sin texto adicional, sin markdown:\n\n${content}`,
    1024
  );

  return parseResult(text, embedding);
}

function parseResult(text, embedding = null) {
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('No JSON found in response');
    const data = JSON.parse(json);

    // Formatear arrays a texto legible para mejor RAG
    const contentText = (data.key_points || []).map(p => `- ${p}`).join('\n');
    const tagsText = (data.suggested_tags || []).join(', ');

    saveCapture.run({
      title: data.title || 'Sin título',
      summary: data.summary || '',
      type: data.type || 'note',
      tags: tagsText,
      content: contentText,
      embedding,
      raw: data.raw_content || ''
    });
    return { success: true, data };
  } catch (err) {
    console.error('[CaptureAgent] Error parseando:', err.message);
    return { success: false, error: 'No se pudo parsear la respuesta', raw: text };
  }
}
