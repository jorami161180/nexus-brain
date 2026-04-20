import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { orchestrate }  from './agents/orchestrator.js';
import { capture }      from './agents/capture.js';
import { classify }     from './agents/classifier.js';
import { query }        from './agents/memory.js';
import { write }        from './agents/writer.js';
import { research }     from './agents/researcher.js';
import { developer }    from './agents/developer.js';

const TESTS = [
  {
    agent: 'orchestrator',
    desc: 'Enrutar una pregunta al agente correcto',
    run: () => orchestrate('Quiero crear una landing page para mi app de finanzas')
  },
  {
    agent: 'capture',
    desc: 'Capturar y estructurar texto',
    run: () => capture({ type: 'text', content: 'NexusWealth es una app de finanzas personales con IA que categoriza gastos automáticamente' })
  },
  {
    agent: 'classifier',
    desc: 'Clasificar contenido',
    run: () => classify('Gestión de finanzas personales con IA y categorización automática de gastos')
  },
  {
    agent: 'memory',
    desc: 'Consultar memoria',
    run: () => query('¿Qué proyectos de finanzas tengo?')
  },
  {
    agent: 'writer',
    desc: 'Generar contenido escrito',
    run: () => write({ type: 'note', topic: 'Beneficios de gestionar finanzas con IA' })
  },
  {
    agent: 'researcher',
    desc: 'Investigar en la web',
    run: () => research('tendencias fintech 2025 para apps de finanzas personales')
  },
  {
    agent: 'developer',
    desc: 'Generar landing page',
    run: () => developer({
      spec: { name: 'NexusWealth', summary: 'App de finanzas personales con IA', features: [{ name: 'Dashboard', description: 'Gráficos de gastos' }] },
      task: 'App fintech de finanzas personales, colores profesionales.',
      projectId: null, projectName: 'NexusWealth'
    })
  }
];

console.log('🧪 Test completo de agentes Nexus Brain\n');
console.log('━'.repeat(50));

for (const test of TESTS) {
  process.stdout.write(`\n[${test.agent.toUpperCase()}] ${test.desc}... `);
  const t0 = Date.now();
  try {
    const result = await test.run();
    const ms = Date.now() - t0;
    const ok = result?.success !== false;
    console.log(ok ? `✅ (${ms}ms)` : `❌ falló`);
    if (!ok) console.log(`   Error: ${result?.error || JSON.stringify(result).slice(0,100)}`);
  } catch (err) {
    console.log(`❌ EXCEPCIÓN: ${err.message.slice(0, 120)}`);
  }
}

console.log('\n' + '━'.repeat(50));
console.log('✅ Test completado\n');
