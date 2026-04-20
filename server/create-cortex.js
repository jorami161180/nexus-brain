import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { saveProject, insertPhase, updatePhase, updateProjectStatus } from './db.js';
import { architect } from './agents/architect.js';
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

console.log(`\n🧠 Creando proyecto: ${PROJECT.name}\n`);

// 1. Insertar en BD
const info = saveProject.run({
  name: PROJECT.name,
  summary: PROJECT.summary,
  stack: JSON.stringify({ frontend: 'React', backend: 'Node.js', database: 'SQLite + embeddings' }),
  features: JSON.stringify(PROJECT.features),
  phases: JSON.stringify(['idea', 'spec', 'dev', 'test', 'deploy', 'live']),
  spec: JSON.stringify(PROJECT),
  github_url: null
});
const projectId = info.lastInsertRowid;
['idea','spec','dev','test','deploy','live'].forEach((key, i) =>
  insertPhase.run({ project_id: projectId, phase_num: i+1, phase_key: key })
);
updatePhase.run({ project_id: projectId, phase_key: 'idea', status: 'done', output: JSON.stringify(PROJECT), notes: 'Proyecto creado por Nexus' });
updateProjectStatus.run({ id: projectId, status: 'planning' });
console.log(`✅ BD — Proyecto ID: ${projectId}`);

// 2. Arquitecto: generar spec técnico
console.log(`\n⚙️  Arquitecto generando spec técnico...`);
const archResult = await architect({ spec: PROJECT, projectId });
if (archResult.success) {
  updatePhase.run({ project_id: projectId, phase_key: 'spec', status: 'done', output: JSON.stringify(archResult.data), notes: 'Spec generado por arquitecto' });
  updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'active', output: '', notes: '' });
  console.log(`✅ Spec técnico generado`);
} else {
  console.log(`⚠️  Arquitecto falló: ${archResult.error}`);
}

// 3. Developer: generar landing page
console.log(`\n🎨 Developer generando landing page...`);
const devResult = await developer({
  spec: PROJECT,
  task: 'App SaaS B2B de gestión de conocimiento para equipos. Elige template que encaje con productividad empresarial. Colores sobrios y profesionales.',
  projectId,
  projectName: PROJECT.name
});
if (devResult.success) {
  updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(devResult.data), notes: devResult.data.notes });
  console.log(`✅ Landing generada → ${devResult.data.workspace_path}`);
  console.log(`   Template: ${devResult.data.notes}`);
} else {
  console.log(`❌ Developer falló: ${devResult.error}`);
}

console.log(`\n🚀 Cortex listo. Proyecto ID: ${projectId}\n`);
process.exit(0);
