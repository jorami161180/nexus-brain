import { developer } from './agents/developer.js';

const projectId = null; // Se crea como sesión nueva sin asociar a proyecto existente
const projectName = 'ProLanding';

// Spec mínimo pero válido para el developer
const spec = {
  name: 'ProLanding',
  summary: 'Landing page profesional para una app de productividad con IA. Hero impactante, sección de features, precios y formulario de contacto',
  features: [
    { name: 'Hero Section', description: 'Hero impactante con headline, descripción y CTA' },
    { name: 'Features Grid', description: '6 features con iconos y descripciones' },
    { name: 'Pricing Plans', description: '3 planes: Starter, Pro, Enterprise' },
    { name: 'Contact Form', description: 'Formulario de contacto elegante' }
  ]
};

console.log('🔄 Regenerando ProLanding landing page...');

const highQualityTask = `Genera una landing page para ProLanding, una app de productividad con IA.
- Elige el template 'minimal' (fondo claro, limpio, profesional — encaja con productividad).
- Colores que evoquen "productividad premium": considera violetas, azules o verdes sofisticados.
- Copy directo y orientado a resultados, sin jerga genérica.`;

const result = await developer({
  spec,
  task: highQualityTask,
  projectId,
  projectName
});

if (result.success) {
  console.log('✅ Landing regenerada correctamente');
  console.log(`📁 Workspace: ${result.data.workspace_path}`);
  console.log(`📄 Archivos: ${result.data.files?.length || 0}`);

} else {
  console.error('❌ Error:', result.error);
}

process.exit(0);
