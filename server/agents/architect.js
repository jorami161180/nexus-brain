import { smartChat } from '../router.js';
import { saveProject } from '../db.js';

const SYSTEM_PROMPT = `Eres el Agente Arquitecto Principal del sistema Nexus Brain.
Tu objetivo es transformar una idea bruta en una especificación técnica de nivel FAANG/Silicon Valley.
Eres experto en patrones de diseño, escalabilidad, seguridad y optimización de stacks modernos.

DIRECTRICES TÉCNICAS:
1. Visión: Define el "norte" técnico del proyecto.
2. Stack: Sé específico (versiones, por qué se elige, bibliotecas clave).
3. Arquitectura de Datos: Esquema formal con tipos, relaciones y optimizaciones.
4. Mapa de Archivos: Estructura de directorios lógica y modular.
5. Roadmap: Fases claras con hitos técnicos.

ESTRUCTURA DE SALIDA (Responde ÚNICAMENTE en JSON):
{
  "name": "Nombre formal del sistema",
  "summary": "Resumen ejecutivo de alto nivel",
  "vision": "Objetivos técnicos y propuesta de valor",
  "stack": {
    "frontend": { "core": "...", "styling": "...", "state": "...", "extras": [] },
    "backend": { "core": "...", "runtime": "...", "auth": "...", "extras": [] },
    "database": { "engine": "...", "schema_type": "...", "notes": "..." }
  },
  "technical_risks": ["Riesgo 1", "Riesgo 2"],
  "features": [
    { 
      "phase_id": 1,
      "name": "Nombre feature", 
      "priority": "high|medium|low", 
      "description": "Explicación técnica detallada",
      "steps": ["Paso de desarrollo 1", "Paso de desarrollo 2"]
    }
  ],
  "file_structure": [
    { "path": "src/components/...", "description": "Propósito del archivo" }
  ],
  "database_schema": [
    { "table": "Nombre", "fields": ["campo (tipo)"], "relations": ["id -> tabla.id"] }
  ],
  "api_endpoints": [
    { "method": "...", "path": "...", "auth": true, "description": "..." }
  ],
  "phases": [
    { "id": 1, "name": "Nombre Fase", "goal": "Hito a alcanzar" }
  ]
}`;

export async function architect({ name, description, platform = 'web', audience = 'general', skipSave = false }) {
  try {
    const { text } = await smartChat(
      'architect',
      SYSTEM_PROMPT,
      `PROYECTO: "${name}"
PLATAFORMA: ${platform}
AUDIENCIA: ${audience}
DESCRIPCIÓN: ${description}

EJECUCIÓN: Diseña el Blueprint técnico completo. Prioriza la modularidad y el rendimiento.
Responde ÚNICAMENTE con el JSON.`,
      4096
    );

    // Eliminar bloque <think> si el modelo lo incluye (qwen3, kimi-k2, etc.)
    const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Intentar JSON directo primero, luego regex
    let data;
    try { data = JSON.parse(stripped); } catch {
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("El modelo no generó un JSON válido");
      data = JSON.parse(jsonMatch[0]);
    }
    
    // Normalizar para persistencia si faltan campos
    const projectName = data.name || name || "Sin nombre";
    
    // Fallback de seguridad para evitar errores de better-sqlite3 con valores undefined
    const record = {
      name:       projectName,
      summary:    data.summary || description || '',
      stack:      JSON.stringify(data.stack || {}),
      features:   JSON.stringify(data.features || []),
      phases:     JSON.stringify(data.phases || []),
      spec:       JSON.stringify(data || {}),
      github_url: null
    };

    if (!skipSave) await saveProject(record);

    return { success: true, data };
  } catch (err) {
    console.error("[Architect Agent ERROR]:", err);
    return { success: false, error: err.message };
  }
}
