import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { developer } from './agents/developer.js';
import fs from 'fs';
import path from 'path';

const PROJECTS = [
  {
    name: 'CryptoTrack',
    task: 'App de tracking de portfolio crypto en tiempo real con alertas y análisis técnico.',
    spec: { name: 'CryptoTrack', summary: 'Portfolio tracker crypto con IA y alertas en tiempo real', features: [{ name: 'Portfolio', description: 'Seguimiento de activos' }] }
  },
  {
    name: 'ZenHR',
    task: 'Software de RRHH para PYMEs: gestión de nóminas, vacaciones y onboarding.',
    spec: { name: 'ZenHR', summary: 'Plataforma de recursos humanos para pequeñas empresas', features: [{ name: 'Nóminas', description: 'Cálculo automático' }] }
  },
  {
    name: 'LaunchFast',
    task: 'Herramienta de marketing viral para startups: A/B testing, funnels y growth hacking.',
    spec: { name: 'LaunchFast', summary: 'Plataforma de growth marketing para startups', features: [{ name: 'A/B Testing', description: 'Tests automáticos' }] }
  }
];

console.log('🧪 Test: Variedad de templates entre proyectos\n');

const results = [];
for (const project of PROJECTS) {
  process.stdout.write(`  Generando ${project.name}... `);
  const result = await developer({ spec: project.spec, task: project.task, projectId: null, projectName: project.name });

  if (result.success) {
    const html = result.data.files[0].code;
    const template = html.includes("font-family:'Space Grotesk'") ? 'bold'
                   : html.includes("font-family:'Sora'")         ? 'minimal'
                   : 'dark';
    const color = html.match(/--primary:\s*(#[a-fA-F0-9]{6})/)?.[1] || '?';
    console.log(`✅  template=${template}  color=${color}`);
    results.push({ name: project.name, template, color });
  } else {
    console.log(`❌  Error: ${result.error}`);
    results.push({ name: project.name, template: 'ERROR', color: '-' });
  }
  if (project !== PROJECTS.at(-1)) await new Promise(r => setTimeout(r, 3000));
}

console.log('\n📊 Resumen:');
console.table(results);

const templates = results.map(r => r.template).filter(t => t !== 'ERROR');
const uniqueTemplates = new Set(templates).size;
const uniqueColors   = new Set(results.map(r => r.color)).size;

console.log(`\n  Templates distintos: ${uniqueTemplates}/${templates.length}`);
console.log(`  Colores distintos:   ${uniqueColors}/${results.length}`);

if (uniqueTemplates >= 2) {
  console.log('\n✅ PASS — al menos 2 diseños distintos generados');
} else {
  console.log('\n⚠️  WARN — todos los proyectos usaron el mismo template (puede pasar con pocos proyectos)');
}
