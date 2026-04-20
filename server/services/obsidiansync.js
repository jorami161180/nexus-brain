import axios from 'axios';
import https from 'https';

const OBSIDIAN_URL = `https://localhost:${process.env.OBSIDIAN_PORT || 27124}`;
const OBSIDIAN_KEY = process.env.OBSIDIAN_API_KEY || '';
const N8N_URL = process.env.N8N_OBSIDIAN_WEBHOOK || 'http://localhost:5678/webhook/nexus-obsidian-sync';

// Obsidian usa certificado auto-firmado — ignorar verificación TLS
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function obsidianHeaders() {
  return { Authorization: `Bearer ${OBSIDIAN_KEY}` };
}

function buildMarkdown({ title, content, tags }) {
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const frontmatter = [
    '---',
    `title: "${title}"`,
    tagList.length ? `tags: [${tagList.join(', ')}]` : '',
    `created: ${new Date().toISOString()}`,
    'source: Nexus Brain',
    '---',
    ''
  ].filter(l => l !== '').join('\n');
  return `${frontmatter}\n${content}`;
}

async function syncDirect({ title, content, folder, tags }) {
  const filename = `${folder ? folder + '/' : ''}${title.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s_-]/g, '').trim()}.md`;
  const md = buildMarkdown({ title, content, tags });

  await axios.put(
    `${OBSIDIAN_URL}/vault/${encodeURIComponent(filename)}`,
    md,
    { headers: { ...obsidianHeaders(), 'Content-Type': 'text/markdown' }, httpsAgent, timeout: 5000 }
  );

  return {
    success: true,
    obsidian_path: filename,
    message: 'Sincronizado directamente con Obsidian'
  };
}

async function syncViaN8n(data) {
  const response = await axios.post(N8N_URL, {
    ...data,
    timestamp: new Date().toISOString(),
    source: 'Nexus Brain v2.0'
  }, { timeout: 5000 });

  return {
    success: true,
    obsidian_path: response.data?.path || `${data.folder || 'Nexus'}/${data.title}.md`,
    message: 'Sincronizado con Obsidian vía n8n'
  };
}

export async function syncToObsidian(data) {
  if (OBSIDIAN_KEY) {
    try {
      return await syncDirect(data);
    } catch (err) {
      console.warn('[ObsidianSync] API directa falló, probando n8n:', err.message);
    }
  }

  try {
    return await syncViaN8n(data);
  } catch (err) {
    console.warn('[ObsidianSync] n8n también falló:', err.message);
    return { success: false, error: 'Obsidian no disponible (API y n8n offline)' };
  }
}
