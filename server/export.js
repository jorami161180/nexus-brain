import fs from 'fs';
import path from 'path';
import { getProjectById, getPhases } from './db.js';

/**
 * Genera un archivo Markdown compatible con Obsidian a partir de un proyecto.
 */
export async function exportProjectToObsidian(projectId) {
  const project = getProjectById(Number(projectId));
  if (!project) throw new Error('Proyecto no encontrado');

  const phases = getPhases(projectId);
  
  let md = `---\ntitle: ${project.name}\ntags: [nexus-project, ${project.status}]\ncreated: ${project.created_at}\n---\n\n`;
  
  md += `# ${project.name}\n\n`;
  md += `## Resumen\n${project.summary || 'Sin descripción.'}\n\n`;
  
  md += `## Pipeline de Desarrollo\n\n`;
  
  phases.forEach(ph => {
    const statusIcon = ph.status === 'done' ? '✅' : ph.status === 'active' ? '⏳' : '⚪';
    md += `### ${ph.phase_num}. ${ph.phase_key.toUpperCase()} [${statusIcon}]\n`;
    md += `**Estado**: ${ph.status}\n`;
    if (ph.notes) md += `**Notas**: ${ph.notes}\n`;
    
    if (ph.output) {
      try {
        const output = JSON.parse(ph.output);
        md += `\n#### Resultado:\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n`;
      } catch {
        md += `\n#### Resultado:\n${ph.output}\n`;
      }
    }
    md += `\n---\n`;
  });

  md += `\n\n*Documento generado automáticamente por Nexus Brain v2.5*`;

  return {
    filename: `Nexus_${project.name.replace(/\s+/g, '_')}.md`,
    content: md
  };
}
