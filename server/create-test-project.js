import 'dotenv/config';
import { developer } from './agents/developer.js';
import { saveProject, insertPhase, updatePhase, updateProjectStatus } from './db.js';

const projectId = null; // Se crea como sesión nueva sin asociar a proyecto existente
const projectName = 'NexusTestProject';

// Especificación mínima pero válida para el agente developer
const spec = {
    name: 'NexusTestProject',
    summary: 'Una landing page para un proyecto de prueba de Nexus Brain, demostrando la capacidad de generación de código.',
    features: [
        { name: 'Hero Section', description: 'Sección principal con título y descripción.' },
        { name: 'Features List', description: 'Lista de 3 características clave.' },
        { name: 'Call to Action', description: 'Botón para interactuar.' }
    ]
};

console.log('🔄 Generando landing page para NexusTestProject...');

const task = `Genera una landing page simple y moderna para "NexusTestProject".
- Elige un template 'minimal' o 'bold'.
- Colores que reflejen innovación y tecnología.
- Contenido conciso y directo.`;

const result = await developer({
    spec,
    task,
    projectId,
    projectName
});

if (result.success) {
    console.log('📦 Guardando proyecto en la base de datos...');

    // 1. Insertar el proyecto
    const info = saveProject.run({
        name: projectName,
        summary: spec.summary,
        stack: JSON.stringify({ frontend: { core: 'HTML/Tailwind', styling: 'Tailwind' } }),
        features: JSON.stringify(spec.features),
        phases: JSON.stringify(['idea', 'spec', 'dev']),
        spec: JSON.stringify(spec),
        github_url: null
    });
    const newId = info.lastInsertRowid;

    // 2. Inicializar fases y marcar 'dev' como completado con los archivos generados
    const phases = ['idea', 'spec', 'dev', 'test', 'deploy', 'live'];
    phases.forEach((key, i) => insertPhase.run({ project_id: newId, phase_num: i + 1, phase_key: key }));

    updatePhase.run({ project_id: newId, phase_key: 'dev', status: 'done', output: JSON.stringify(result.data), notes: 'Generado vía test script' });
    updateProjectStatus.run({ id: newId, status: 'dev' });

    console.log(`\n✅ ¡Proyecto listo!`);
    console.log(`🌐 URL de vista previa: http://localhost:3002/workspace/nexustestproject/index.html`);
    console.log(`🚀 Míralo en el dashboard: http://localhost:3002 (Pestaña Proyectos)`);
} else {
    console.error('❌ Error generando la landing page:', result.error);
}

process.exit(0);