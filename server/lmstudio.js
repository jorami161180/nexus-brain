import OpenAI from 'openai';

// LM Studio expone API compatible con OpenAI en localhost:1234
export const lm = new OpenAI({
  baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
  apiKey: 'lm-studio' // no se usa pero es requerido
});

export const MODELS = {
  orchestrator: process.env.LM_MODEL_ORCHESTRATOR || 'google/gemma-3-4b',
  capture: process.env.LM_MODEL_CAPTURE || 'zai-org/glm-4.6v-flash',
  classifier: process.env.LM_MODEL_CLASSIFIER || 'google/gemma-3-1b',
  memory: process.env.LM_MODEL_MEMORY || 'deepseek/deepseek-r1-0528-qwen3-8b',
  writer: process.env.LM_MODEL_WRITER || 'qwen/qwen3.5-9b',
  projects: process.env.LM_MODEL_PROJECTS || 'qwen/qwen2.5-coder-14b',
  researcher: process.env.LM_MODEL_RESEARCHER || 'deepseek/deepseek-r1-0528-qwen3-8b'
};

export async function chat(model, system, userMessage, maxTokens = 1024) {
  const response = await lm.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage }
    ]
  });
  return response.choices[0].message.content;
}

// Re-exportar smartChat para que los agentes puedan usarlo
export { smartChat } from './router.js';
