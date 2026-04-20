import { smartChat } from '../router.js';
import axios from 'axios';
import { saveProject } from '../db.js';
import { syncToObsidian } from '../services/obsidiansync.js';

const SYSTEM_PROMPT = `Eres el Agente Proyectos del sistema Nexus Brain.
Analizas y gestionas proyectos de desarrollo.

Devuelve JSON con:
{
  "action": "create_repo | update_status | create_task | summarize",
  "repo_name": "nombre-del-repo",
  "description": "descripción del proyecto",
  "stack": "tecnología principal",
  "tasks": ["tarea1", "tarea2"],
  "milestones": ["hito1", "hito2"],
  "status": "planning | active | paused | completed",
  "notes": "notas adicionales"
} \nIMPORTANTE: No añadas Markdown extra, solo el JSON.`;

export async function manageProject(action, projectData) {
  try {
    const { text } = await smartChat(
      'projects',
      SYSTEM_PROMPT,
      `Acción: ${action}\nDatos: ${JSON.stringify(projectData)}\n\nAnaliza y estructura este proyecto.`,
      1024
    );

    // Extracción robusta: quitar fences de markdown antes del regex
    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    let parsed;
    try {
      const jsonStr = cleaned.match(/\{[\s\S]*\}/)?.[0];
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Fallback: construir estructura mínima con los datos del usuario
      console.warn('[ProjectsAgent] No se pudo parsear JSON del modelo, usando fallback.');
      const safeName = (projectData.name || 'Proyecto').toLowerCase().replace(/\s+/g, '-');
      parsed = {
        action: 'create_repo',
        repo_name: safeName,
        description: projectData.content || 'Proyecto creado con Nexus Brain',
        stack: projectData.stack || 'vite',
        tasks: ['Configurar entorno', 'Crear estructura base', 'Implementar MVP'],
        milestones: ['v0.1 Prototipo', 'v0.5 Beta', 'v1.0 Lanzamiento'],
        status: 'planning',
        notes: text.substring(0, 500)
      };
    }

    // 1. Integración GitHub
    let githubInfo = null;
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_USERNAME) {
      try {
        githubInfo = await createGitHubRepo(parsed);
        console.log(`[ProjectsAgent] GitHub Repo creado: ${githubInfo.url}`);
      } catch (err) {
        console.error('[ProjectsAgent] Error creando repo en GitHub:', err.message);
      }
    }

    // 2. Integración Obsidian (vía n8n)
    let obsidianInfo = null;
    try {
      obsidianInfo = await syncToObsidian({
        title: parsed.repo_name || projectData.name,
        folder: `Nexus/${parsed.stack || 'General'}`,
        tags: ['nexus', 'project', parsed.stack].filter(Boolean),
        content: `
# ${parsed.repo_name || projectData.name}
> ${parsed.description || projectData.content}

## Stack
- **Tecnología**: ${parsed.stack || 'Nexus'}
- **Estado**: ${parsed.status || 'planning'}
${githubInfo ? `- **GitHub**: ${githubInfo.url}` : ''}

## Roadmap
${(parsed.milestones || []).map(m => `- [ ] ${m}`).join('\n')}

## Tareas Iniciales
${(parsed.tasks || []).map(t => `- [ ] ${t}`).join('\n')}

---
*Generado por Nexus Brain v2.0*
        `
      });
      console.log(`[ProjectsAgent] Obsidian Sync: ${obsidianInfo?.success ? 'OK' : 'FAIL'}`);
    } catch (obsErr) {
      console.error('[ProjectsAgent] Error syncing to Obsidian:', obsErr.message);
    }

    // 3. Guardado en DB Local
    try {
      saveProject.run({
        name: parsed.repo_name || projectData.name,
        summary: parsed.description || projectData.content,
        stack: parsed.stack || projectData.stack,
        features: JSON.stringify(parsed.tasks || []),
        phases: JSON.stringify(parsed.milestones || []),
        spec: parsed.notes || '',
        github_url: githubInfo?.url || null
      });
    } catch (dbErr) {
      console.error('[ProjectsAgent] Error guardando proyecto en DB:', dbErr.message);
    }

    return { 
      success: true, 
      data: parsed, 
      github: githubInfo,
      obsidian: obsidianInfo 
    };
  } catch (err) {
    console.error('[ProjectsAgent] Error crítico:', err?.message || err);
    const reason = err?.message || err?.code || 'No se pudo conectar con el modelo de IA (¿LM Studio en puerto 1234?)';
    return { success: false, error: reason };
  }
}

async function createGitHubRepo(project) {
  const response = await axios.post(
    'https://api.github.com/user/repos',
    { name: project.repo_name, description: project.description || 'Project created by Nexus Brain', private: true, auto_init: true },
    { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } }
  );
  return { name: response.data.name, url: response.data.html_url, ssh_url: response.data.ssh_url };
}

export async function generateTaskSteps(projectName, projectSummary, taskName) {
  try {
    const prompt = `Eres el Agente Proyectos de Nexus Brain.
Tu objetivo es desglosar la siguiente tarea de alto nivel en 5-7 micro-pasos técnicos y accionables (comandos, creación de archivos, código base).

Proyecto: "${projectName}"
Resumen: "${projectSummary}"
Tarea a desglosar: "${taskName}"

Devuelve ÚNICAMENTE un JSON con esta estructura:
{
  "steps": [
    "Paso 1: hacer esto",
    "Paso 2: hacer lo otro"
  ]
}`;

    const { text } = await smartChat('projects', 'Eres el Agente Proyectos de Nexus Brain. Desglosa tareas en micro-pasos técnicos accionables. Responde ÚNICAMENTE con JSON.', prompt, 1024);
    
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonStr = cleaned.match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(jsonStr);
    
    return { success: true, steps: parsed.steps || [] };
  } catch (err) {
    console.error('[ProjectsAgent] Error generando pasos:', err.message);
    return { success: false, error: 'No se pudieron generar los pasos', steps: [] };
  }
}
