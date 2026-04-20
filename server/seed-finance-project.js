import 'dotenv/config';
import { saveProject, insertPhase, updatePhase, updateProjectStatus } from './db.js';

const projectName = 'NexusWealth';
const summary = 'Un gestor de finanzas personales que utiliza IA para categorizar gastos mediante lenguaje natural y ofrece consejos de inversión basados en tendencias actuales.';

const spec = {
    name: projectName,
    summary,
    features: [
        { name: 'Input de Gastos Natural', description: 'Permite escribir "Cené pizza por 15€" y lo registra automáticamente.' },
        { name: 'Dashboard de Gastos', description: 'Gráficos simples con Tailwind y estados de React para ver el balance mensual.' },
        { name: 'Asesor de Inversión', description: 'Usa el agente Researcher para buscar tendencias de mercado y dar consejos.' }
    ]
};

console.log(`🚀 Inyectando proyecto real: ${projectName}...`);

const info = saveProject.run({
    name: projectName,
    summary: summary,
    stack: JSON.stringify({ frontend: { core: 'React/Tailwind', styling: 'Tailwind' }, database: 'SQLite' }),
    features: JSON.stringify(spec.features),
    phases: JSON.stringify(['idea', 'spec', 'dev', 'test']),
    spec: JSON.stringify(spec),
    github_url: null
});

const newId = info.lastInsertRowid;

// Inicializar fases
const phases = ['idea', 'spec', 'dev', 'test', 'deploy', 'live'];
phases.forEach((key, i) => insertPhase.run({ project_id: newId, phase_num: i + 1, phase_key: key }));

// Marcar la idea como completada
updatePhase.run({ project_id: newId, phase_key: 'idea', status: 'done', output: JSON.stringify({ description: summary }), notes: 'Proyecto de prueba real inicializado.' });
updatePhase.run({ project_id: newId, phase_key: 'spec', status: 'active', output: '', notes: '' });
updateProjectStatus.run({ id: newId, status: 'planning' });

console.log(`\n✅ Proyecto ${projectName} creado con ID: ${newId}`);
console.log(`👉 Ahora abre http://localhost:3002, ve a Proyectos y ejecuta la fase de "Arquitecto".`);