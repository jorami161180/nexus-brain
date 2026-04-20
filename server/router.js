/**
 * Nexus Brain — Smart Model Router
 * Distribuye peticiones entre LM Studio, Ollama y Claude
 * con fallback automático si un proveedor falla.
 */

import OpenAI from 'openai';
import axios from 'axios';

// Clientes
const lmStudio = new OpenAI({
  baseURL: process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1',
  apiKey: 'lm-studio'
});

const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';


// Mapa de modelos por agente y proveedor
// Groq: llama-3.1-8b-instant (rápido/barato) para routing y tareas simples
//       llama-3.3-70b-versatile (potente) para razonamiento y síntesis
//       deepseek-r1-distill-llama-70b (razonamiento profundo) para código y arquitectura
export const AGENT_MODELS = {
  orchestrator: {
    groq: 'llama-3.1-8b-instant',           // routing rápido, no necesita 70B
    lmstudio: process.env.LM_MODEL_ORCHESTRATOR || 'google/gemma-3-4b', // Equilibrado para lógica de rutas
    ollama: process.env.OLLAMA_MODEL_ORCHESTRATOR || 'llama3.2',
    claude: 'claude-haiku-4-5'                // ✅ nombre correcto Anthropic
  },
  chat: {
    groq: 'llama-3.1-8b-instant',           // conversación casual: rápido y barato
    lmstudio: process.env.LM_MODEL_ORCHESTRATOR || 'google/gemma-3-4b',
    ollama: process.env.OLLAMA_MODEL_ORCHESTRATOR || 'llama3.2',
    claude: 'claude-haiku-4-5'
  },
  capture: {
    groq: 'llama-3.1-8b-instant',           // extracción simple
    lmstudio: process.env.LM_MODEL_CAPTURE || 'zai-org/glm-4.6v-flash',
    ollama: process.env.OLLAMA_MODEL_CAPTURE || 'llama3.2',
    claude: 'claude-haiku-4-5'
  },
  classifier: {
    groq: 'llama-3.1-8b-instant',           // clasificación simple
    lmstudio: process.env.LM_MODEL_CLASSIFIER || 'google/gemma-3-1b', // Muy rápido para etiquetas
    ollama: process.env.OLLAMA_MODEL_CLASSIFIER || 'llama3.2',
    claude: 'claude-haiku-4-5'
  },
  memory: {
    groq: 'llama-3.3-70b-versatile',        // RAG: mejor comprensión semántica
    lmstudio: process.env.LM_MODEL_MEMORY || 'deepseek/deepseek-r1-0528-qwen3-8b', // Uso de razonamiento para RAG
    ollama: process.env.OLLAMA_MODEL_MEMORY || 'llama3.2',
    claude: 'claude-sonnet-4-5'               // ✅ nombre correcto Anthropic
  },
  writer: {
    groq: 'llama-3.3-70b-versatile',        // escritura: calidad narrativa
    lmstudio: process.env.LM_MODEL_WRITER || 'qwen/qwen3.5-9b',
    ollama: process.env.OLLAMA_MODEL_WRITER || 'llama3.2',
    claude: 'claude-sonnet-4-5'               // ✅ nombre correcto Anthropic
  },
  projects: {
    groq: 'llama-3.1-8b-instant',           // gestión de tareas: rápido
    lmstudio: process.env.LM_MODEL_PROJECTS || 'qwen/qwen2.5-coder-14b',
    ollama: process.env.OLLAMA_MODEL_PROJECTS || 'llama3.2',
    claude: 'claude-haiku-4-5'
  },
  architect: {
    groq: 'llama-3.1-8b-instant',           // diseño técnico: rápido
    lmstudio: process.env.LM_MODEL_ARCHITECT || 'qwen/qwen2.5-coder-14b', // Mejor capacidad técnica
    ollama: process.env.OLLAMA_MODEL_ARCHITECT || 'llama3.2',
    claude: 'claude-haiku-4-5'
  },
  developer: {
    groq: 'llama-3.3-70b-versatile',        // código: JSON limpio + prompt detallado para diseño profesional
    lmstudio: process.env.LM_MODEL_DEVELOPER || 'qwen/qwen2.5-coder-14b',
    ollama: process.env.OLLAMA_MODEL_DEVELOPER || 'qwen2.5-coder:latest',
    claude: 'claude-sonnet-4-5'
  },
  researcher: {
    groq: 'meta-llama/llama-4-scout-17b-16e-instruct',  // investigación: Llama 4, contexto largo
    lmstudio: process.env.LM_MODEL_RESEARCHER || 'deepseek/deepseek-r1-0528-qwen3-8b',
    ollama: process.env.OLLAMA_MODEL_RESEARCHER || 'llama3.2',
    claude: 'claude-sonnet-4-5'
  },
  testing: {
    groq: 'llama-3.1-8b-instant',
    lmstudio: process.env.LM_MODEL_TESTING || 'qwen/qwen2.5-coder-14b', // Sincronizado con tu modelo instalado
    ollama: 'llama3.2',
    claude: 'claude-haiku-4-5'
  }
};

/**
 * Genera embeddings vectoriales usando el modelo Nomic instalado en LM Studio
 */
export async function getEmbedding(text) {
  try {
    const response = await lmStudio.embeddings.create({
      model: "text-embedding-nomic-embed-text-v1.5",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.error('[Router] Error generando embedding:', err);
    return null;
  }
}

/**
 * Verifica si un modelo específico está cargado y listo en LM Studio
 */
export async function isModelLoaded(modelId) {
  try {
    const response = await lmStudio.models.list();
    return response.data.some(m => m.id === modelId);
  } catch (err) {
    console.error('[Router] No se pudo conectar con LM Studio para verificar modelos:', err.message);
    return false;
  }
}

// Orden de prioridad por defecto: Groq → LM Studio → Ollama → Claude
// Groq: rápido, bueno para tareas de baja/media complejidad
// Claude: mejor calidad para tareas complejas (código, arquitectura, escritura)
const PROVIDER_ORDER = ['groq', 'lmstudio', 'ollama', 'claude'];

// Estrategia por agente:
// - FAST   (Groq 8B primero): orquestación, chat, clasificación, captura, proyectos
// - SMART  (Groq 70B):        investigación, memoria, escritura
// - DEEP   (Groq deepseek-r1 → Claude → LM Studio): código y arquitectura
const AGENT_PROVIDER_ORDER = {
  orchestrator: ['groq', 'lmstudio', 'ollama', 'claude'],  // 8B: routing rápido
  chat: ['groq', 'lmstudio', 'ollama', 'claude'],  // 8B: conversación casual
  classifier: ['groq', 'lmstudio', 'ollama', 'claude'],  // 8B: clasificación simple
  capture: ['groq', 'lmstudio', 'ollama', 'claude'],  // 8B: extracción de datos
  projects: ['groq', 'lmstudio', 'ollama', 'claude'],  // 8B: gestión de proyectos
  researcher: ['groq', 'lmstudio', 'ollama', 'claude'],  // 70B: síntesis de búsqueda
  memory: ['groq', 'lmstudio', 'ollama', 'claude'],  // 70B: RAG semántico
  writer: ['groq', 'lmstudio', 'ollama', 'claude'],  // 70B: redacción y estilo
  architect: ['lmstudio', 'groq', 'ollama', 'claude'],  // Priorizar Qwen 14B local
  developer: ['lmstudio', 'groq', 'claude', 'ollama'],  // Priorizar Qwen 14B local para ahorrar créditos
  testing: ['lmstudio', 'groq', 'ollama'], // Priorizar LM Studio para testing local
};

// Agentes que generan código largo — no usar json_object mode en Groq
const CODE_AGENTS = new Set(['developer', 'architect', 'writer']);

export async function smartChat(agent, system, userMessage, maxTokens = 1024, image = null) {
  const models = AGENT_MODELS[agent] || AGENT_MODELS.orchestrator;
  const rawOrder = AGENT_PROVIDER_ORDER[agent] || PROVIDER_ORDER;
  // Skip local providers if their base URLs are not explicitly set
  const hasLmStudio = !!process.env.LM_STUDIO_BASE_URL;
  const hasOllama = !!process.env.OLLAMA_BASE_URL;
  const order = rawOrder.filter(p => {
    if (p === 'lmstudio' && !hasLmStudio) return false;
    if (p === 'ollama' && !hasOllama) return false;
    return true;
  });
  const failures = [];

  for (const provider of order) {
    try {
      const result = await callProvider(provider, models[provider], system, userMessage, maxTokens, agent, image);
      if (result) {
        console.log(`[${agent}] ✅ → ${provider} (${models[provider]}) ${image ? '(IMAGE)' : ''}`);
        return { text: result, provider, model: models[provider] };
      }
    } catch (err) {
      const reason = err.message || String(err);
      failures.push(`${provider}: ${reason.slice(0, 180)}`);
      console.warn(`[${agent}] ❌ ${provider} falló: ${err.message?.slice(0, 120)} — probando siguiente...`);
    }
  }

  const details = failures.length ? ` Detalles: ${failures.join(' | ')}` : '';
  throw new Error(`Todos los proveedores fallaron para el agente "${agent}". Verifica LM Studio en :1234, el modelo cargado, Groq/Anthropic keys u Ollama en :11434.${details}`);
}

// Modelos qwen3 tienen thinking activado por defecto — desactivar con /no_think
const QWEN3_MODELS = new Set(['qwen/qwen3-32b', 'qwen/qwen3-8b', 'qwen/qwen3-14b']);

async function callProvider(provider, model, system, userMessage, maxTokens, agent = '', image = null) {
  // Función helper para construir el contenido del mensaje (texto o texto+imagen)
  const buildContent = (msg, img, prov) => {
    if (!img) return msg;
    if (prov === 'claude') {
      return [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.includes(',') ? img.split(',')[1] : img } },
        { type: 'text', text: msg }
      ];
    }
    // Formato OpenAI / LM Studio / Ollama
    return [
      { type: 'text', text: msg },
      { type: 'image_url', image_url: { url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}` } }
    ];
  };

  if (provider === 'groq' && process.env.GROQ_API_KEY) {
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const isJsonMode = !CODE_AGENTS.has(agent) && (system.includes('"title"') || system.includes('JSON'));
    const noThinkPrefix = QWEN3_MODELS.has(model) ? '/no_think\n' : '';
    
    try {
      const res = await groq.chat.completions.create({
        model: model || 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
        ...(isJsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildContent(noThinkPrefix + userMessage, image, 'groq') }
        ]
      });
      return res.choices[0].message.content;
    } catch (err) {
      if (err.status === 429) throw err; // Re-throw to trigger provider fallback
      throw err;
    }
  }

  if (provider === 'lmstudio') {
    const timeout = Number(process.env.LM_STUDIO_TIMEOUT) || 15000;
    const res = await lmStudio.chat.completions.create(
      {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildContent(userMessage, image, 'lmstudio') }
        ]
      },
      { timeout }
    );
    return res.choices[0].message.content;
  }

  if (provider === 'ollama') {
    const res = await axios.post(`${ollamaBase}/api/chat`, {
      model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildContent(userMessage, image, 'ollama') }
      ]
    }, { timeout: 60000 });
    return res.data.message?.content;
  }

  if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await claude.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: buildContent(userMessage, image, 'claude') }]
    });
    return res.content[0].text;
  }

  return null;
}
