import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { saveDeploy } from '../db.js';

const VERCEL_API = 'https://api.vercel.com';
const DEPLOY_POLL_INTERVAL_MS = 2000;
const DEPLOY_TIMEOUT_MS = 120000;

/**
 * Lee archivos del workspace generado por el Developer en disco.
 * Si no hay workspace, devuelve array vacío.
 */
function readWorkspaceFiles(projectName) {
  const safeName = (projectName || '')
    .toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 50);
  const wsPath = path.resolve(process.cwd(), 'workspace', safeName);
  if (!fs.existsSync(wsPath)) return [];

  const results = [];
  function walk(dir, base = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, rel); }
      else {
        try { results.push({ path: rel, code: fs.readFileSync(full, 'utf8') }); }
        catch { /* ignorar archivos binarios */ }
      }
    }
  }
  walk(wsPath);
  console.log(`[Deploy] Leídos ${results.length} archivos del workspace: ${wsPath}`);
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDeploymentReady(deploymentId, headers) {
  const startedAt = Date.now();
  let lastData = null;

  while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
    const { data } = await axios.get(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers,
      timeout: 30000
    });
    lastData = data;

    if (data.readyState === 'READY') return data;
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      const message = data.error?.message || `Deployment ${data.readyState}`;
      throw new Error(message);
    }

    await sleep(DEPLOY_POLL_INTERVAL_MS);
  }

  return lastData;
}

export async function deploy({ projectName, files }) {
  // Si no recibimos archivos, intentar leer del workspace en disco
  if (!files?.length) {
    files = readWorkspaceFiles(projectName);
  }
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { success: false, error: 'VERCEL_TOKEN no configurado' };
  if (!files?.length) return { success: false, error: 'No hay archivos para desplegar' };

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 50);

  try {
    // Formatear archivos para Vercel
    const vercelFiles = files.map(f => ({
      file: f.path.replace(/^\//, ''),
      data: Buffer.from(f.code || '').toString('base64'),
      encoding: 'base64'
    }));

    // Asegurar que haya un index.html si hay HTML
    const hasIndex = vercelFiles.some(f => f.file === 'index.html');
    const htmlFile = vercelFiles.find(f => f.file.endsWith('.html'));
    if (!hasIndex && htmlFile) {
      vercelFiles.push({ ...htmlFile, file: 'index.html' });
    }

    // Crear deployment
    const { data } = await axios.post(`${VERCEL_API}/v13/deployments`, {
      name: slug,
      files: vercelFiles,
      projectSettings: { framework: null },
      target: 'production'
    }, { headers, timeout: 60000 });

    const finalData = await waitForDeploymentReady(data.id, headers);
    const deployUrl = `https://${finalData.url || data.url}`;
    const projectUrl = `https://${slug}.vercel.app`;

    saveDeploy.run({
      project_name: slug,
      deploy_url:   deployUrl,
      project_url:  projectUrl,
      status:       finalData.readyState || data.readyState || 'BUILDING',
      files_count:  vercelFiles.length
    });

    return {
      success: true,
      data: {
        deploymentId: data.id,
        deployUrl,
        projectUrl,
        status: finalData.readyState || data.readyState || 'BUILDING',
        inspectorUrl: finalData.inspectorUrl,
        aliases: finalData.alias || [],
        name: slug
      }
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { success: false, error: msg };
  }
}
