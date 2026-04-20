import 'dotenv/config';
import { saveProject, insertPhase, updatePhase, updateProjectStatus } from './db.js';

const projectName = 'NexusHealth';
const summary = 'Un monitor de biohacking personal que integra datos de sueño, nutrición y ejercicio. Usa IA para correlacionar hábitos con niveles de energía y productividad.';

const spec = {
    name: projectName,
    summary,
    features: [
        { name: 'Registro de Sueño y Energía', description: 'Dashboard para anotar horas de sueño y nivel de energía percibido al despertar.' },
        { name: 'Analizador de Nutrición', description: 'Usa el agente Researcher para analizar si tu dieta actual favorece la longevidad.' },
        { name: 'Generador de Rutinas HIIT', description: 'Genera entrenamientos de alta intensidad adaptados al tiempo disponible.' }
    ]
};

console.log(`🚀 Sembrando proyecto real: ${projectName}...`);

const info = saveProject.run({
    name: projectName,
    summary: summary,
    stack: JSON.stringify({ frontend: { core: 'React/Tailwind', styling: 'Modern/Dark' }, database: 'SQLite' }),
    features: JSON.stringify(spec.features),
    phases: JSON.stringify(['idea', 'spec', 'dev']),
    spec: JSON.stringify(spec),
    github_url: null
});

const newId = info.lastInsertRowid;

// Inicializar fases
const phases = ['idea', 'spec', 'dev', 'test', 'deploy', 'live'];
phases.forEach((key, i) => insertPhase.run({ project_id: newId, phase_num: i + 1, phase_key: key }));

// Marcar la idea como completada
updatePhase.run({ project_id: newId, phase_key: 'idea', status: 'done', output: JSON.stringify({ description: summary }), notes: 'Iniciado proyecto de Biohacking para pruebas reales.' });
updatePhase.run({ project_id: newId, phase_key: 'spec', status: 'active', output: '', notes: '' });
updateProjectStatus.run({ id: newId, status: 'planning' });

console.log(`\n✅ Proyecto ${projectName} inyectado.`);
console.log(`👉 Ejecuta 'npm start' y ve al dashboard para iniciar la fase de arquitectura con tu Qwen 14B local.`);