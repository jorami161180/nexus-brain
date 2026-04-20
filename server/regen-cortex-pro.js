import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { developer } from './agents/developer.js';

const PROJECT = {
  name: 'Cortex',
  summary: 'Segundo cerebro para equipos: captura reuniones, notas y documentos y los convierte automáticamente en conocimiento conectado. Busca por semántica, detecta duplicados y sugiere conexiones entre ideas.',
  features: [
    { name: 'Captura Inteligente', description: 'Pega texto, sube PDFs o graba voz — Cortex lo estructura solo' },
    { name: 'Búsqueda Semántica', description: 'Encuentra ideas por significado, no solo por palabras exactas' },
    { name: 'Conexiones Automáticas', description: 'La IA detecta relaciones entre notas y las enlaza visualmente' },
    { name: 'Resúmenes de Reuniones', description: 'Convierte transcripciones en actas con decisiones y tareas' },
    { name: 'Base de Conocimiento', description: 'Wiki viva que se actualiza sola a medida que el equipo trabaja' },
    { name: 'Asistente Q&A', description: 'Pregunta en lenguaje natural y responde con tus propios documentos' }
  ]
};

console.log('🔄 Regenerando Cortex con template pro...\n');

const result = await developer({
  spec: PROJECT,
  task: 'App SaaS B2B de gestión de conocimiento para equipos empresariales. USA el template "pro" — diseño profesional con mockup de producto, logos de empresas, testimonios y secciones alternadas. Colores: azul índigo oscuro (#4f46e5) como primario y cyan (#06b6d4) como acento.',
  projectId: 21,
  projectName: 'cortex'
});

if (result.success) {
  console.log(`✅ Landing regenerada → ${result.data.workspace_path}`);
  console.log(`   ${result.data.notes}`);
} else {
  console.log(`❌ Error: ${result.error}`);
}

process.exit(0);
