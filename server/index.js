import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { smartChat, getEmbedding } from './router.js';
import { NexusOrchestrator } from '../orchestrator.ts';
import { orchestrate } from './agents/orchestrator.js';
import { capture } from './agents/capture.js';
import { classify } from './agents/classifier.js';
import { query } from './agents/memory.js';
import { manageProject, generateTaskSteps } from './agents/projects.js';
import { write } from './agents/writer.js';
import { research } from './agents/researcher.js';
import { testLanding } from './agents/testing.js';
import { developer } from './agents/developer.js';
import { deploy } from './agents/deploy.js';
import { architect } from './agents/architect.js';
import { exportProjectToObsidian } from './export.js';
import { triggerN8nWorkflow } from './services/n8n.js';

import {
  getCaptures, getProjects, getDeploys, getMemoryQueries, getDevSessions,
  searchCaptures, getStats, getProjectById, getProjectTasks, updateProjectFeatures,
  saveProject, insertPhase, updatePhase, updateProjectStatus,
  getPhases, getPhase, getProjectsWithPhases, getRecentResearches,
  createUser, getUserByEmail, getUserById, incrementUserRuns,
  updateUserPlan, checkRunLimit,
  createResetToken, getResetToken, markTokenUsed, updateUserPassword
} from './db.js';
import db from './db.js';
import bcrypt from 'bcryptjs';
import { signToken, requireAuth } from './middleware/auth.js';

const PHASES = [
  { num: 1, key: 'idea', label: 'Idea' },
  { num: 2, key: 'spec', label: 'Especificación' },
  { num: 3, key: 'dev', label: 'Desarrollo' },
  { num: 4, key: 'test', label: 'Testing' },
  { num: 5, key: 'deploy', label: 'Deploy' },
  { num: 6, key: 'live', label: 'En producción' },
];

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());

// Webhook Stripe necesita raw body — registrar ANTES de express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  if (!STRIPE_SECRET || !STRIPE_WEBHOOK_SECRET) return res.sendStatus(400);
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(STRIPE_SECRET);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const userId = Number(event.data.object.metadata?.userId);
    if (userId) updateUserPlan.run({ id: userId, plan: 'pro' });
  }
  if (event.type === 'customer.subscription.deleted') {
    const email = event.data.object.customer_email;
    if (email) { const u = getUserByEmail(email); if (u) updateUserPlan.run({ id: u.id, plan: 'free' }); }
  }
  res.sendStatus(200);
});

app.use(express.json({ limit: '10mb' }));

// Servir frontend estático
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(DIST);

if (isProd) {
  app.use(express.static(DIST, { index: false }));
} else {
  app.use(express.static(ROOT, { index: false }));
}
app.use('/public', express.static(path.join(ROOT, 'public')));
app.get('/', (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/app', (_, res) => res.sendFile(isProd ? path.join(DIST, 'index.html') : path.join(ROOT, 'index.html')));
app.get('/landing', (_, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// Health check
app.get('/health', (_, res) => {
  res.json({ status: 'ok', version: '2.0.0', agents: 10 });
});
app.get('/api/ping', (_, res) => res.json({ ok: true }));

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.get('/api/auth/status', (_, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  res.json({ hasUsers: count > 0 });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'El email ya está registrado' });
  const password_hash = await bcrypt.hash(password, 10);
  const result = createUser.run({ email: email.toLowerCase(), password_hash, name: name || email.split('@')[0] });
  const user = getUserById(result.lastInsertRowid);
  res.json({ token: signToken({ id: user.id, email: user.email }), user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = getUserByEmail(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const { password_hash, ...safeUser } = user;
  res.json({ token: signToken({ id: user.id, email: user.email }), user: safeUser });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = getUserByEmail((email || '').toLowerCase());
  // Siempre responder OK para no revelar si el email existe
  if (user) {
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    createResetToken.run({ user_id: user.id, token });
    const { sendResetEmail } = await import('./services/mailer.js');
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await sendResetEmail(user.email, token, appUrl);
  }
  res.json({ ok: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Datos incompletos' });
  const record = getResetToken(token);
  if (!record) return res.status(400).json({ error: 'Token inválido o expirado' });
  const hash = await bcrypt.hash(password, 10);
  updateUserPassword.run({ hash, id: record.user_id });
  markTokenUsed.run({ token });
  res.json({ ok: true });

});

// Proteger todas las rutas /api/* excepto /auth/*
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  requireAuth(req, res, next);
});

// ─── Registro Unificado de Agentes ───────────────────────────────────
// Define cómo se ejecuta cada agente de forma centralizada
const getAgentsRegistry = (input, historyContext, context, reasoning) => ({
  chat: async () => {
    const chatSystemPrompt = `Eres Nexus Brain, un asistente de IA personal inteligente y amigable. Respondes de forma natural, concisa y útil en español.`;
    const prompt = `${historyContext ? 'Historial:\n' + historyContext + '\n\n' : ''}Usuario: ${input}`;
    const res = await smartChat('chat', chatSystemPrompt, prompt, 512);
    const cleaned = res.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return { success: true, data: { answer: cleaned }, provider: res.provider };
  },
  memory: () => query(input, historyContext ? [`--- HISTORIAL DE CONVERSACIÓN ---\n${historyContext}`] : []),
  researcher: () => research(input),
  writer: () => write({ topic: input, content: input, ...context, sync: false }),
  projects: () => {
    // Si el input parece una sugerencia/idea, usamos el redactor para creatividad
    if (/idea|suger|recomiend|qué.*proyecto|cuál.*proyecto|dame|propón/i.test(input)) {
      return write({ topic: input, content: input, type: 'note', sync: false });
    }
    return manageProject('summarize', { name: input, ...context });
  },
  capture: async () => {
    // Generar el vector semántico usando el modelo local Nomic
    const vector = await getEmbedding(input);
    const res = await capture({
      type: 'text',
      content: input,
      embedding: vector ? JSON.stringify(vector) : null
    });
    // Si el orquestador detectó una entidad específica (Regla 6), personalizamos la respuesta
    if (res.success && reasoning.includes('REGLA_6_CAPTURA')) {
      const entity = reasoning.split(': ')[1] || 'este tema';
      res.data.answer = `✅ Entendido. He guardado esta nueva información sobre **${entity}** en mi memoria a largo plazo.`;
    }
    return res;
  },
  architect: () => architect({ description: input, ...context }),
  developer: () => developer({ task: input, ...context, projectName: context.projectName || 'NexusApp' }),
  automation: async () => {
    const res = await triggerN8nWorkflow({ input, context, historyContext });
    if (res.success) {
      return { success: true, data: { answer: `✅ ¡Flujo de n8n disparado con éxito!\n\nDatos de respuesta:\n\`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\`` }, provider: 'n8n:local' };
    }
    return { success: false, error: res.error || 'Fallo al disparar n8n webhook' };
  },
  testing: async () => {
    const res = await smartChat('testing', 'Eres un experto en QA. Analiza el código y propón tests.', input, 1024);
    return { success: true, data: { answer: res.text }, provider: res.provider };
  }
});

// ─── Chat con Streaming (SSE) ─────────────────────────────────────────
// Orquesta + ejecuta el agente delegado en streaming token a token
app.post('/api/chat', async (req, res) => {
  const { input, context = {}, history = [] } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Construir contexto de conversación a partir del historial (últimos 6 turnos)
    const historyContext = history.slice(-6)
      .map(m => `${m.role === 'user' ? 'Usuario' : 'Nexus'}: ${m.content}`)
      .join('\n');

    // 0. Recuperación de Memoria (RAG)
    let memoryContext = '';
    try {
      const searchResults = db.prepare(`SELECT c.* FROM captures_fts f JOIN captures c ON f.rowid = c.id WHERE captures_fts MATCH ? ORDER BY rank LIMIT 3`).all(input.replace(/[^a-zA-Z0-9 ]/g, '') + '*');
      if (searchResults.length) {
        memoryContext = "--- MEMORIA RECUPERADA (Datos capturados anteriormente) ---\n" + 
          searchResults.map(r => `[${r.title}]: ${r.summary || r.content}`).join('\n') + "\n";
      }
    } catch (e) { console.error('[RAG] Error en búsqueda rápida:', e.message); }

    // 1. Orquestar la petición
    console.log(`[Chat] Iniciando orquestación para: "${input}"`);
    let orchResult = await orchestrate(input, { ...context, conversationHistory: historyContext, memoryContext });

    if (!orchResult.success) {
      throw new Error(`Orquestación fallida: ${orchResult.error}`);
    }

    // 1.1 Refinar decisión con el motor optimizado
    const refined = NexusOrchestrator.refine(input, orchResult.orchestration);
    const { agent, reasoning, confidence } = refined;

    // 1.2 Persistir rastro (Auditoría)
    NexusOrchestrator.persist(input, orchResult.orchestration, refined);

    console.log(`[Orquestador] Destino: ${agent} (Razonamiento: ${reasoning})`);

    // Informar al frontend del agente elegido
    send('agent_activity', { agent, reasoning, confidence });

    // 2. Ejecutar el agente correspondiente
    const registry = getAgentsRegistry(input, historyContext, context, reasoning);
    const executor = registry[agent] || registry.chat;
    const agentResult = await executor();

    // 3. Verificar que el agente respondió correctamente
    if (!agentResult || (!agentResult.success && agentResult.error)) {
      const errMsg = agentResult?.error || 'El agente no devolvió respuesta';
      console.error(`[Chat] Agente "${agent}" falló:`, errMsg);
      send('token', { token: `⚠️ Error del agente ${agent}: ${errMsg}` });
      send('final_data', { data: { answer: `Error: ${errMsg}` } });
      send('done', {});
      res.end();
      return;
    }

    const d = agentResult.data || {};
    const finalAnswer = d.answer || d.summary || d.content || d.description || d.notes ||
      agentResult.answer || agentResult.summary || agentResult.content ||
      (typeof agentResult === 'string' ? agentResult : '');

    console.log(`[Chat] Respuesta del agente "${agent}":`, finalAnswer ? `${finalAnswer.slice(0, 100)}...` : '(vacía)');

    // Simular streaming del texto principal
    if (finalAnswer) {
      const words = finalAnswer.split(' ');
      for (let i = 0; i < words.length; i++) {
        send('token', { token: words[i] + (i === words.length - 1 ? '' : ' ') });
        if (words.length < 100) await new Promise(r => setTimeout(r, 10));
      }
    } else {
      // Fallback: si no hay texto, enviar un mensaje genérico
      send('token', { token: '¡Hola! Soy Nexus Brain. ¿En qué puedo ayudarte hoy?' });
    }

    // Enviamos el objeto COMPLETO para que la UI renderice tags, botones, etc.
    send('final_data', agentResult);

    send('done', {});
    res.end();
  } catch (err) {
    console.error('[Chat Error]', err);
    send('error', { message: err.message });
    res.end();
  }
});

// ─── Chat simple (sin SSE, para uso directo) ─────────────────────────
app.post('/api/chat/simple', async (req, res) => {
  const { input, context = {}, history = [] } = req.body;

  try {
    // Construir contexto de conversación a partir del historial (últimos 6 turnos)
    const historyContext = history.slice(-6)
      .map(m => `${m.role === 'user' ? 'Usuario' : 'Nexus'}: ${m.content}`)
      .join('\n');

    // 1. Orquestar la petición
    console.log(`[Chat Simple] Iniciando orquestación para: "${input}"`);
    let orchResult = await orchestrate(input, { ...context, conversationHistory: historyContext });

    if (!orchResult.success) {
      throw new Error(`Orquestación fallida: ${orchResult.error}`);
    }

    // 1.1 Refinar decisión con el motor optimizado
    const refined = NexusOrchestrator.refine(input, orchResult.orchestration);
    const { agent, reasoning, confidence } = refined;

    // 1.2 Persistir rastro (Auditoría)
    NexusOrchestrator.persist(input, orchResult.orchestration, refined);

    console.log(`[Chat Simple] Agente elegido: ${agent}`);

    // 2. Ejecutar el agente correspondiente (Usando el registro unificado)
    const registry = getAgentsRegistry(input, historyContext, context, reasoning);
    const executor = registry[agent] || registry.chat;
    const agentResult = await executor();

    // 3. Verificar que el agente respondió correctamente
    if (!agentResult || (!agentResult.success && agentResult.error)) {
      const errMsg = agentResult?.error || 'El agente no devolvió respuesta';
      console.error(`[Chat Simple] Agente "${agent}" falló:`, errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    }

    // 4. Extraer texto legible de cualquier estructura
    const d = agentResult.data || {};
    const finalAnswer = d.answer || d.summary || d.content || d.description || d.notes ||
      agentResult.answer || agentResult.summary || agentResult.content ||
      (typeof agentResult === 'string' ? agentResult : '');

    console.log(`[Chat Simple] Respuesta del agente "${agent}":`, finalAnswer ? `${finalAnswer.slice(0, 100)}...` : '(vacía)');

    res.json({
      success: true,
      agent,
      reasoning,
      data: {
        answer: finalAnswer,
        ...d
      }
    });
  } catch (err) {
    console.error('[Chat Simple Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Orquestador ──────────────────────────────────────────────────────
app.post('/api/orchestrate', async (req, res) => {
  try {
    const result = await orchestrate(req.body.input, req.body.context);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Captura ──────────────────────────────────────────────────────────
app.post('/api/capture', async (req, res) => {
  try {
    const result = await capture(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Clasificador ─────────────────────────────────────────────────────
app.post('/api/classify', async (req, res) => {
  try {
    const result = await classify(req.body.content, req.body.existingTags);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Memoria Q&A ──────────────────────────────────────────────────────
app.post('/api/memory/query', async (req, res) => {
  try {
    const result = await query(req.body.question, req.body.context);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/memory/graph', (req, res) => {
  try {
    const captures = db.prepare('SELECT id, title, type, tags FROM captures').all();
    const nodes = captures.map(c => ({
      id: c.id,
      label: c.title,
      type: c.type,
      tags: c.tags ? c.tags.split(',').map(t => t.trim()) : []
    }));

    const links = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const commonTags = nodes[i].tags.filter(t => nodes[j].tags.includes(t));
        if (commonTags.length > 0) {
          links.push({ source: nodes[i].id, target: nodes[j].id, value: commonTags.length });
        }
      }
    }

    res.json({ success: true, nodes, links });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Proyectos ────────────────────────────────────────────────────────
app.post('/api/projects', async (req, res) => {
  try {
    // Soportar tanto la estructura de index.html {name, content} como de app.js {projectData}
    const action = req.body.action || 'create';
    const projectData = req.body.projectData || {
      name: req.body.name,
      content: req.body.content || req.body.description,
      stack: req.body.stack
    };

    const result = await manageProject(action, projectData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/projects/:id', (req, res) => {
  try {
    const project = getProjectById(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/generate-steps', async (req, res) => {
  try {
    const { projectId, taskName } = req.body;
    const project = getProjectById(Number(projectId));
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const result = await generateTaskSteps(project.name, project.summary, taskName);
    if (!result.success) return res.status(500).json({ error: result.error });

    // Update the features JSON in the database with the new steps
    let features = [];
    try { features = JSON.parse(project.features || '[]'); } catch (e) { }

    // Find the task inside features. It could be a string or an object.
    const taskIndex = features.findIndex(f => (typeof f === 'string' ? f : f.name) === taskName);
    if (taskIndex !== -1) {
      if (typeof features[taskIndex] === 'string') {
        features[taskIndex] = { name: taskName, description: '', steps: result.steps };
      } else {
        features[taskIndex].steps = result.steps;
      }
      updateProjectFeatures.run({ features: JSON.stringify(features), id: project.id });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Redactor ─────────────────────────────────────────────────────────
app.post('/api/write', async (req, res) => {
  try {
    const result = await write(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Exportación ───────────────────────────────────────────────────────────
app.get('/api/projects/:id/export', async (req, res) => {
  try {
    const { filename, content } = await exportProjectToObsidian(req.params.id);
    res.setHeader('Content-disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-type', 'text/markdown');
    res.send(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Investigador (SSE streaming) ────────────────────────────────────────────
app.post('/api/research', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload = {}) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  try {
    const result = await research(req.body.query, req.body.depth, true, send);
    if (result.success) {
      send('done', { data: result.data, sources: result.sources, provider: result.provider, fromCache: result.fromCache });
    } else {
      send('error', { error: result.error });
    }
  } catch (err) {
    try {
      const devPhase = getPhase(projectId, 'dev');
      if (devPhase?.output) {
        updatePhase.run({
          project_id: projectId,
          phase_key: 'dev',
          status: 'done',
          output: devPhase.output,
          notes: `Refinado no aplicado: ${err.message}`
        });
      }
    } catch { }
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// ─── Investigaciones recientes (para historial) ───────────────────────────────
app.get('/api/research/recent', (_, res) => {
  try { res.json(getRecentResearches()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Arquitecto ───────────────────────────────────────────────────────
app.post('/api/architect', async (req, res) => {
  try {
    const result = await architect(req.body);
    res.json(result);
  } catch (err) {
    console.error("[Server Error /api/architect]:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ─── Developer ────────────────────────────────────────────────────────
app.post('/api/developer', async (req, res) => {
  try {
    const result = await developer(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Testing ───────────────────────────────────────────────────────────
app.post('/api/test', async (req, res) => {
  try {
    const { html, projectName, spec } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML es requerido' });

    const result = await testLanding({ html, projectName, spec });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deploy ───────────────────────────────────────────────────────────
app.post('/api/deploy', async (req, res) => {
  try {
    const result = await deploy(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pipeline de Proyectos ────────────────────────────────────────────────────

// Listar todos los proyectos con sus fases
app.get('/api/pipeline', (_, res) => {
  try { res.json(getProjectsWithPhases()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear nuevo proyecto con fases inicializadas
app.post('/api/pipeline', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const info = saveProject.run({
      name, summary: description || '', stack: '{}',
      features: '[]', phases: '[]', spec: '', github_url: null
    });
    const projectId = info.lastInsertRowid;
    PHASES.forEach(p => insertPhase.run({ project_id: projectId, phase_num: p.num, phase_key: p.key }));
    // Marcar fase idea como activa
    updatePhase.run({ project_id: projectId, phase_key: 'idea', status: 'active', output: JSON.stringify({ description }), notes: '' });
    res.json({ success: true, id: projectId, projectId, name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener proyecto con fases — si no tiene fases las inicializa automáticamente
app.get('/api/pipeline/:id', (req, res) => {
  try {
    const project = getProjectById(Number(req.params.id));
    if (!project) return res.status(404).json({ error: 'No encontrado' });
    let phases = getPhases(project.id);
    if (!phases.length) {
      // Proyecto creado fuera del pipeline (ej: vía chat) — inicializar fases
      PHASES.forEach(p => insertPhase.run({ project_id: project.id, phase_num: p.num, phase_key: p.key }));
      updatePhase.run({
        project_id: project.id, phase_key: 'idea', status: 'active',
        output: JSON.stringify({ description: project.summary }), notes: ''
      });
      phases = getPhases(project.id);
    }
    // Auto-avanzar fases: si la anterior está done y la siguiente pending → activarla
    const order = ['idea', 'spec', 'dev', 'test', 'deploy', 'live'];
    const phaseMap = Object.fromEntries(phases.map(ph => [ph.phase_key, ph]));
    let advanced = false;
    for (let i = 0; i < order.length - 1; i++) {
      const cur = phaseMap[order[i]];
      const next = phaseMap[order[i + 1]];
      if (cur?.status === 'done' && next?.status === 'pending') {
        updatePhase.run({ project_id: project.id, phase_key: order[i + 1], status: 'active', output: '', notes: '' });
        advanced = true;
      }
    }
    if (advanced) phases = getPhases(project.id);

    project.phases = phases;
    res.json(project);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Actualizar estado/notas de una fase manualmente
app.put('/api/pipeline/:id/phases/:phaseKey', (req, res) => {
  try {
    const { status, notes, output } = req.body;
    const projectId = Number(req.params.id);
    const phase = getPhase(projectId, req.params.phaseKey);
    updatePhase.run({ 
      project_id: projectId, 
      phase_key: req.params.phaseKey, 
      status: status || phase.status, 
      output: output || phase.output || '', 
      notes: notes || phase.notes || '' 
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parsePhaseOutput(phase, fallback = {}) {
  try {
    return phase?.output ? JSON.parse(phase.output) : fallback;
  } catch {
    return fallback;
  }
}

function getPrimaryHtmlFile(devData) {
  return devData.files?.find(f => f.path?.endsWith('.html') || f.path === 'index.html');
}

function stripTags(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractEditableFields(html = '') {
  const fields = [];
  const counters = {};
  const pattern = /<(h[1-4]|p|a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[3]);
    if (!text || text.length > 700) continue;
    counters[tag] = (counters[tag] || 0) + 1;
    fields.push({
      key: `${tag}:${counters[tag] - 1}`,
      tag,
      label: tag.startsWith('h') ? `Titulo ${counters[tag]}` : tag === 'p' ? `Texto ${counters[tag]}` : `Boton/enlace ${counters[tag]}`,
      value: text
    });
  }

  return fields;
}

function applyEditableFields(html = '', fields = []) {
  const values = new Map((fields || []).map(field => [field.key, String(field.value || '')]));
  const counters = {};

  return html.replace(/<(h[1-4]|p|a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs) => {
    const normalizedTag = tag.toLowerCase();
    const index = counters[normalizedTag] || 0;
    counters[normalizedTag] = index + 1;
    const key = `${normalizedTag}:${index}`;
    if (!values.has(key)) return full;
    return `<${tag}${attrs}>${escapeHtml(values.get(key))}</${tag}>`;
  });
}

function getHeadContent(html = '') {
  return html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
}

function buildSectionPreviewHtml(pageHtml, sectionHtml) {
  const head = getHeadContent(pageHtml);
  return `<!DOCTYPE html>
<html lang="es">
<head>
${head}
<style>
  html, body { min-height: 100%; }
  body { margin: 0; overflow-x: hidden; }
  nav { position: relative !important; top: auto !important; }
</style>
</head>
<body>
${sectionHtml}
</body>
</html>`;
}

function labelLandingPart(html, fallback) {
  const attr = html.match(/\b(?:id|class)=["']([^"']+)["']/i)?.[1];
  const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
  const text = stripTags(heading || attr || fallback);
  return text ? text.slice(0, 70) : fallback;
}

function extractLandingParts(html) {
  const parts = [];
  const pattern = /<(nav|header|section|footer)\b[\s\S]*?<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const block = match[0];
    const type = match[1].toLowerCase();
    parts.push({
      index: parts.length,
      type,
      label: labelLandingPart(block, `${type} ${parts.length + 1}`),
      html: block,
      text: stripTags(block).slice(0, 360),
      fullText: stripTags(block),
      fields: extractEditableFields(block),
      previewHtml: buildSectionPreviewHtml(html, block),
      start: match.index,
      end: match.index + block.length
    });
  }
  return parts;
}

function writeProjectFilesToWorkspace(project, files) {
  const safeName = (project.name || `project-${project.id}`)
    .toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 50);
  const workspaceRoot = path.resolve(ROOT, 'workspace', safeName);
  for (const file of files || []) {
    if (!file.path || !file.code) continue;
    const safePath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(workspaceRoot, safePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.code, 'utf8');
  }
  return workspaceRoot;
}

function parseJsonObject(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function parseSectionHtmlResponse(text, rootTag) {
  const parsed = parseJsonObject(text);
  if (parsed?.html) return { html: String(parsed.html).trim(), notes: parsed.notes || '' };

  const clean = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:html|json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const match = clean.match(new RegExp(`<${rootTag}\\b[\\s\\S]*?<\\/${rootTag}>`, 'i'));
  if (!match) return null;
  return { html: match[0].trim(), notes: 'Seccion regenerada desde HTML directo' };
}

function buildLocalSectionFallback(part, prompt, mode) {
  const opening = part.html.match(new RegExp(`^<${part.type}\\b([^>]*)>`, 'i'));
  const attrs = opening?.[1] || '';
  const inner = part.html
    .replace(new RegExp(`^<${part.type}\\b[^>]*>`, 'i'), '')
    .replace(new RegExp(`</${part.type}>\\s*$`, 'i'), '')
    .trim();
  const safePrompt = escapeHtml(prompt).slice(0, 180);

  if (mode === 'visual') {
    return `<${part.type}${attrs} data-nexus-refined="visual">
  <div style="max-width:1120px;margin:0 auto;padding:clamp(32px,6vw,72px) 20px;">
    <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:18px;padding:7px 10px;border:1px solid rgba(0,188,212,.35);border-radius:999px;background:rgba(0,188,212,.08);color:#00BCD4;font:800 11px/1 system-ui;text-transform:uppercase;letter-spacing:.08em;">Redisenado con Nexus</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px;align-items:start;">
      <div style="padding:26px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.02));box-shadow:0 24px 80px rgba(0,0,0,.28);">
        ${inner}
      </div>
      <aside style="padding:24px;border-radius:18px;background:#00BCD4;color:#051014;box-shadow:0 22px 70px rgba(0,188,212,.22);">
        <strong style="display:block;font:900 18px/1.2 system-ui;margin-bottom:10px;">Enfoque del cambio</strong>
        <p style="font:600 14px/1.5 system-ui;margin:0;">${safePrompt || 'Se reforzo la jerarquia visual, el contraste y la lectura de esta seccion.'}</p>
      </aside>
    </div>
  </div>
</${part.type}>`;
  }

  return `<${part.type}${attrs} data-nexus-refined="copy">
  <div style="max-width:1120px;margin:0 auto;padding:clamp(28px,5vw,56px) 20px;">
    <div style="margin-bottom:16px;padding:12px 14px;border-left:4px solid #FF9800;background:rgba(255,152,0,.08);color:inherit;">
      <strong style="display:block;font:900 13px/1.3 system-ui;margin-bottom:4px;">Refinado aplicado</strong>
      <span style="font:600 13px/1.5 system-ui;">${safePrompt || 'Se ajusto esta seccion para hacerla mas clara y accionable.'}</span>
    </div>
    ${inner}
  </div>
</${part.type}>`;
}

function parseFullHtmlResponse(text) {
  const parsed = parseJsonObject(text);
  if (parsed?.html) return { html: String(parsed.html).trim(), notes: parsed.notes || '' };

  const clean = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:html|json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const match = clean.match(/<!doctype html[\s\S]*?<\/html>/i) || clean.match(/<html[\s\S]*?<\/html>/i);
  if (!match) return null;
  const html = match[0].trim();
  return {
    html: /^<!doctype/i.test(html) ? html : `<!DOCTYPE html>\n${html}`,
    notes: 'Landing refinada desde HTML directo'
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function normalizeHtmlForCompare(html = '') {
  return String(html).replace(/\s+/g, ' ').trim();
}

async function runLandingTestingPhase({ projectId, project, send }) {
  send('progress', { message: 'Agente Testing iniciando...' });
  updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'running', output: '', notes: '' });

  const devPhase = getPhase(projectId, 'dev');
  const devData = parsePhaseOutput(devPhase);
  const specPhase = getPhase(projectId, 'spec');
  const spec = parsePhaseOutput(specPhase);
  const htmlFile = devData.files?.find(f => f.path?.endsWith('.html') || f.path === 'index.html');

  if (!htmlFile?.code) {
    send('progress', { message: 'No se encontro HTML para testear' });
    updatePhase.run({
      project_id: projectId,
      phase_key: 'test',
      status: 'error',
      output: JSON.stringify({ error: 'No hay HTML para validar' }),
      notes: 'Error: Developer no genero HTML'
    });
    return { success: false, error: 'No se encontro HTML generado en la fase de desarrollo' };
  }

  const result = await testLanding({
    html: htmlFile.code,
    projectName: project.name,
    spec,
    onProgress: message => send('progress', { message })
  });

  if (!result.success) {
    send('progress', { message: `Error en testing: ${result.error}` });
    updatePhase.run({
      project_id: projectId,
      phase_key: 'test',
      status: 'error',
      output: JSON.stringify({ error: result.error }),
      notes: result.error
    });
    return result;
  }

  const report = result.data;
  send('progress', { message: `Testing completado - Score: ${report.score}/100` });

  if (report.passed) {
    send('progress', { message: 'Landing aprobada - activando Deploy' });
    updatePhase.run({
      project_id: projectId,
      phase_key: 'test',
      status: 'done',
      output: JSON.stringify(report),
      notes: `Score: ${report.score}/100`
    });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'active', output: '', notes: '' });
    updateProjectStatus.run({ id: projectId, status: 'tested' });
    return { success: true, data: report, approved: true, devData };
  }

  const criticalIssues = report.issues.filter(issue => issue.severity === 'critical');
  send('progress', { message: `Landing necesita mejoras - Score: ${report.score}/100` });
  updatePhase.run({
    project_id: projectId,
    phase_key: 'test',
    status: 'failed',
    output: JSON.stringify(report),
    notes: `Score: ${report.score}/100, ${criticalIssues.length} issues criticos`
  });
  return {
    success: true,
    data: report,
    approved: false,
    needsRegeneration: true,
    message: `Testing fallo: ${criticalIssues.map(issue => issue.message).join(', ')}`
  };
}

async function runDeployPhase({ projectId, project, files, send }) {
  send('progress', { message: 'Agente Deploy iniciando...' });
  updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'running', output: '', notes: '' });
  send('progress', { message: 'Subiendo archivos a Vercel...' });

  const result = await deploy({ projectName: project.name, files });
  if (result.success) {
    send('progress', { message: `Desplegado en ${result.data.projectUrl}` });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'done', output: JSON.stringify(result.data), notes: '' });
    updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'active', output: '', notes: '' });
    updateProjectStatus.run({ id: projectId, status: 'deployed' });
  } else {
    send('progress', { message: `Deploy no completado: ${result.error}` });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
  }
  return result;
}

// Ejecutar una fase con SSE streaming — el cliente recibe progreso en tiempo real
app.post('/api/pipeline/:id/run/:phaseKey', async (req, res) => {
  // Configurar SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload = {}) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const projectId = Number(req.params.id);
  const phaseKey = req.params.phaseKey;

  try {
    // Rate limiting — solo fases que consumen créditos
    const METERED_PHASES = ['spec', 'dev', 'test', 'deploy'];
    if (METERED_PHASES.includes(phaseKey)) {
      const user = getUserById(req.user.id);
      const { allowed, used, limit } = checkRunLimit(user);
      if (!allowed) {
        send('error', { error: `Límite del plan alcanzado (${used}/${limit} runs). Actualiza a Pro para continuar.` });
        return res.end();
      }
      incrementUserRuns.run({ id: req.user.id });
    }

    const project = getProjectById(projectId);
    if (!project) { send('error', { error: 'Proyecto no encontrado' }); return res.end(); }

    let result;

    if (phaseKey === 'idea') {
      send('progress', { message: 'Confirmando idea...' });
      updatePhase.run({ project_id: projectId, phase_key: 'idea', status: 'done', output: JSON.stringify({ description: project.summary, notes: req.body.notes || '' }), notes: req.body.notes || '' });
      updatePhase.run({ project_id: projectId, phase_key: 'spec', status: 'active', output: '', notes: '' });
      result = { success: true, data: { message: 'Idea confirmada — listo para especificación' } };

    } else if (phaseKey === 'spec') {
      send('progress', { message: 'Agente Arquitecto iniciando...' });
      updatePhase.run({ project_id: projectId, phase_key: 'spec', status: 'running', output: '', notes: '' });
      send('progress', { message: 'Diseñando stack y arquitectura...' });

      // Timeout de 90 segundos para evitar bloqueo indefinido
      const specTimeout = setTimeout(() => {
        console.log(`[Spec] Timeout del agente architect — usando fallback`);
      }, 90000);

      try {
        const specPromise = architect({ name: project.name, description: project.summary, platform: 'web', audience: 'general', skipSave: true });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: El agente architect tardó demasiado')), 90000));
        result = await Promise.race([specPromise, timeoutPromise]);
        clearTimeout(specTimeout);
      } catch (timeoutErr) {
        console.error('[Spec] Timeout detectado:', timeoutErr.message);
        result = { success: false, error: 'El agente architect no respondió a tiempo. Revisa que LM Studio tenga el modelo cargado.' };
      }

      if (result.success) {
        send('progress', { message: 'Blueprint generado — guardando...' });
        updatePhase.run({ project_id: projectId, phase_key: 'spec', status: 'done', output: JSON.stringify(result.data), notes: '' });
        updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'active', output: '', notes: '' });
        updateProjectStatus.run({ id: projectId, status: 'spec' });
      } else {
        send('progress', { message: `Error en especificación: ${result.error}` });
        updatePhase.run({ project_id: projectId, phase_key: 'spec', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
      }

    } else if (phaseKey === 'dev') {
      send('progress', { message: 'Agente Developer iniciando...' });
      updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'running', output: '', notes: '' });
      const specPhase = getPhase(projectId, 'spec');
      const spec = specPhase?.output ? JSON.parse(specPhase.output) : {};
      send('progress', { message: `Generando código para "${project.name}"...` });

      // Prompt dinámico para forzar la originalidad basada en el proyecto
      const designIntent = `\nCRITERIOS DE DISEÑO para "${project.name}":
      - Identifica el NICHO exacto y ajusta TODOS los elementos (copy, colores, template) a ese sector.
      - Elige colores que comuniquen la personalidad del producto, no paleta genérica purple/cyan.
      - Headlines: menciona el problema/beneficio CONCRETO del nicho, nada de frases de relleno.
      - Template: "pro" para B2B/SaaS, "bold" para consumer/fitness/gaming, "minimal" para diseño/creativos, "dark" para dev/AI/crypto.
      - Stats y testimonials: datos creíbles y específicos del sector con cargos reales.
      - Features: nombres que suenen a producto real (como Stripe, Linear, Notion), no a PowerPoint.`;

      const taskWithStyle = (req.body.task || 'Genera el código inicial del proyecto') + designIntent;

      result = await developer({ spec, task: taskWithStyle, context: req.body.context || '', projectId, projectName: project.name });
      if (result.success) {
        const fileCount = result.data.files?.length || 0;
        send('progress', { message: `${fileCount} archivos generados — guardando en workspace...` });
        updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(result.data), notes: '' });
        updateProjectStatus.run({ id: projectId, status: 'dev' });
        send('progress', { message: 'Activando testing automatico de la landing...' });
        const testResult = await runLandingTestingPhase({ projectId, project, send });
        if (testResult?.approved) {
          result = await runDeployPhase({
            projectId,
            project,
            files: testResult.devData?.files || result.data.files || [],
            send
          });
        } else {
          result = testResult;
        }
      } else {
        updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
      }

    } else if (phaseKey === 'test') {
      result = await runLandingTestingPhase({ projectId, project, send });
      if (result?.approved) {
        result = await runDeployPhase({
          projectId,
          project,
          files: result.devData?.files || [],
          send
        });
      }

    } else if (phaseKey === 'test_legacy') {
      send('progress', { message: '🧪 Agente Testing iniciando...' });
      updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'running', output: '', notes: '' });

      // Obtener HTML del dev phase
      const devPhase = getPhase(projectId, 'dev');
      const devData = devPhase?.output ? JSON.parse(devPhase.output) : {};
      const specPhase = getPhase(projectId, 'spec');
      const spec = specPhase?.output ? JSON.parse(specPhase.output) : {};

      // Buscar el archivo HTML principal
      const htmlFile = devData.files?.find(f => f.path.endsWith('.html') || f.path === 'index.html');

      if (!htmlFile?.code) {
        send('progress', { message: '❌ No se encontró HTML para testear' });
        updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'error', output: JSON.stringify({ error: 'No hay HTML para validar' }), notes: 'Error: Developer no generó HTML' });
        result = { success: false, error: 'No se encontró HTML generado en la fase de desarrollo' };
      } else {
        send('progress', { message: '🔍 Validando estructura y placeholders...' });

        // Ejecutar testing automático
        result = await testLanding({
          html: htmlFile.code,
          projectName: project.name,
          spec,
          onProgress: (msg) => send('progress', { message: msg })
        });

        if (result.success) {
          const testReport = result.data;
          send('progress', { message: `✅ Testing completado — Score: ${testReport.score}/100` });

          if (testReport.passed) {
            send('progress', { message: '✅ Landing aprobada — listo para deploy' });
            updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'done', output: JSON.stringify(testReport), notes: `Score: ${testReport.score}/100` });
            updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'active', output: '', notes: '' });
            updateProjectStatus.run({ id: projectId, status: 'tested' });
          } else {
            send('progress', { message: `⚠️ Landing necesita mejoras — Score: ${testReport.score}/100` });
            const criticalIssues = testReport.issues.filter(i => i.severity === 'critical');
            updatePhase.run({
              project_id: projectId,
              phase_key: 'test',
              status: 'failed',
              output: JSON.stringify(testReport),
              notes: `Score: ${testReport.score}/100, ${criticalIssues.length} issues críticos`
            });
            result = {
              success: true,
              data: testReport,
              needsRegeneration: true,
              message: `Testing falló: ${criticalIssues.map(i => i.message).join(', ')}`
            };
          }
        } else {
          send('progress', { message: `❌ Error en testing: ${result.error}` });
          updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
        }
      }

    } else if (phaseKey === 'deploy') {
      const devPhase = getPhase(projectId, 'dev');
      const devData = devPhase?.output ? JSON.parse(devPhase.output) : {};
      result = await runDeployPhase({ projectId, project, files: devData.files || [], send });

    } else if (phaseKey === 'deploy_legacy') {
      send('progress', { message: 'Agente Deploy iniciando...' });
      updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'running', output: '', notes: '' });
      const devPhase = getPhase(projectId, 'dev');
      const devData = devPhase?.output ? JSON.parse(devPhase.output) : {};
      send('progress', { message: 'Subiendo archivos a Vercel...' });
      result = await deploy({ projectName: project.name, files: devData.files || [] });
      if (result.success) {
        send('progress', { message: `Desplegado en ${result.data.projectUrl}` });
        updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'done', output: JSON.stringify(result.data), notes: '' });
        updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'active', output: '', notes: '' });
        updateProjectStatus.run({ id: projectId, status: 'deployed' });
      } else {
        updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
      }

    } else if (phaseKey === 'live') {
      send('progress', { message: 'Marcando proyecto como live...' });
      const deployPhase = getPhase(projectId, 'deploy');
      const deployData = parsePhaseOutput(deployPhase);
      const liveUrl = req.body.url || deployData.projectUrl || deployData.deployUrl || '';
      updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'done', output: JSON.stringify({ url: liveUrl, notes: req.body.notes || '' }), notes: req.body.notes || '' });
      updateProjectStatus.run({ id: projectId, status: 'live' });
      result = { success: true, data: { message: '🚀 Proyecto en producción' } };

    } else {
      send('error', { error: 'Fase no válida' });
      return res.end();
    }

    if (result?.success) {
      send('done', { data: result.data });
    } else {
      send('error', { error: result?.error || 'Error desconocido' });
    }
  } catch (err) {
    console.error(`[Pipeline] Error en fase ${phaseKey}:`, err);
    try { updatePhase.run({ project_id: projectId, phase_key: phaseKey, status: 'error', output: JSON.stringify({ error: err.message }), notes: err.message }); } catch { }
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// Aprobar una fase manualmente (con notas, bugs, etc.) — SSE streaming para consistencia
app.post('/api/pipeline/:id/phases/:phaseKey/approve', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload = {}) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const projectId = Number(req.params.id);
  const phaseKey = req.params.phaseKey;
  const { notes, bugs, coverage, url } = req.body;

  try {
    const project = getProjectById(projectId);
    if (!project) throw new Error('Proyecto no encontrado');

    const currentPhase = getPhase(projectId, phaseKey);
    const outputData = parsePhaseOutput(currentPhase);

    // Actualizar datos según la fase
    if (phaseKey === 'test' && (bugs !== undefined || coverage)) {
      outputData.bugs = bugs;
      outputData.coverage = coverage;
    }
    if (phaseKey === 'live' && url) {
      outputData.url = url;
    }

    send('progress', { message: `Aprobando fase ${phaseKey}...` });

    updatePhase.run({
      project_id: projectId,
      phase_key: phaseKey,
      status: 'done',
      output: JSON.stringify(outputData),
      notes: notes || currentPhase.notes || ''
    });

    // Activar la siguiente fase automáticamente
    const order = ['idea', 'spec', 'dev', 'test', 'deploy', 'live'];
    const idx = order.indexOf(phaseKey);
    if (idx !== -1 && idx < order.length - 1) {
      const nextKey = order[idx + 1];
      updatePhase.run({ project_id: projectId, phase_key: nextKey, status: 'active', output: '', notes: '' });
      send('progress', { message: `Fase ${nextKey.toUpperCase()} activada` });
    }

    send('done', { success: true });
  } catch (err) {
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// ─── Historial ────────────────────────────────────────────────────────────────
app.get('/api/history/stats', (_, res) => res.json(getStats()));

app.get('/api/history/captures', (req, res) => res.json(getCaptures(Number(req.query.limit) || 50)));
app.get('/api/history/projects', (req, res) => res.json(getProjects(Number(req.query.limit) || 20)));
app.get('/api/history/deploys', (req, res) => res.json(getDeploys(Number(req.query.limit) || 20)));
app.get('/api/history/memory', (req, res) => res.json(getMemoryQueries(Number(req.query.limit) || 20)));
app.get('/api/history/dev', (req, res) => res.json(getDevSessions(Number(req.query.limit) || 20)));
app.get('/api/history/search', (req, res) => res.json(searchCaptures(req.query.q || '')));

// ─── Edición de Proyectos ──────────────────────────────────────────────────────
app.patch('/api/pipeline/:id', (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { name, summary } = req.body;
    let queries = [];
    if (name !== undefined) queries.push(`name = '${name.replace(/'/g, "''")}'`);
    if (summary !== undefined) queries.push(`summary = '${summary.replace(/'/g, "''")}'`);
    
    if (queries.length > 0) {
      db.prepare(`UPDATE projects SET ${queries.join(', ')} WHERE id = ?`).run(projectId);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Refinar fase Dev (iteración sobre código generado) ───────────────────────
app.post('/api/pipeline/:id/refine', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (type, payload = {}) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const projectId = Number(req.params.id);
  try {
    const project = getProjectById(projectId);
    if (!project) { send('error', { error: 'Proyecto no encontrado' }); return res.end(); }

    const feedback = String(req.body.feedback || '').trim();
    if (!feedback) {
      send('error', { error: 'Feedback requerido para refinar' });
      return;
    }

    const devPhaseCurrent = getPhase(projectId, 'dev');
    const currentData = parsePhaseOutput(devPhaseCurrent);
    const currentHtmlFile = getPrimaryHtmlFile(currentData);
    if (!currentHtmlFile?.code) {
      send('error', { error: 'No hay HTML generado para refinar' });
      return;
    }

    send('progress', { message: 'Agente Developer aplicando tus instrucciones al HTML actual...' });
    updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'running', output: devPhaseCurrent?.output || '', notes: '' });
    setTimeout(() => {
      send('progress', { message: 'Reescribiendo la landing existente sin perder estructura, SEO ni responsive...' });
    }, 5000);

    const system = `Eres un senior frontend engineer y product designer. Modificas una landing HTML existente siguiendo instrucciones del usuario.
Devuelve UNICAMENTE JSON valido con esta forma:
{"html":"<!DOCTYPE html>...","notes":"resumen corto de cambios"}
Reglas:
- Respeta la landing actual y aplica el mandato del usuario de forma visible.
- Devuelve el documento HTML completo actualizado.
- Mantén IDs de navegacion, anchors, SEO, responsive y scripts existentes salvo que el usuario pida cambiarlos.
- No devuelvas markdown ni explicaciones fuera del JSON.`;

    const user = `Proyecto: ${project.name}
Resumen: ${project.summary || ''}
Mandato del usuario: ${feedback}

HTML actual:
${currentHtmlFile.code}`;

    const ai = await withTimeout(
      smartChat('developer', system, user, 8000),
      220000,
      'El refinado tardo demasiado. Prueba con una instruccion mas concreta o usa Revisar Secciones.'
    );
    const parsed = parseFullHtmlResponse(ai.text);
    if (!parsed?.html || !/<html[\s\S]*<\/html>/i.test(parsed.html)) {
      updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: devPhaseCurrent?.output || JSON.stringify(currentData), notes: 'Refinado no aplicado: respuesta invalida' });
      send('error', { error: 'El modelo no devolvio un HTML completo valido. Prueba con un mandato mas concreto o usa Revisar Secciones.' });
      return;
    }

    currentHtmlFile.code = parsed.html;
    currentData.workspace_path = writeProjectFilesToWorkspace(project, currentData.files);
    currentData.notes = `${currentData.notes || ''}\nRefinado global: ${feedback}`.trim();

    updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(currentData), notes: `Refinado: ${feedback}` });
    updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'active', output: '', notes: 'Pendiente tras refinado global' });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'pending', output: '', notes: '' });
    updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'pending', output: '', notes: '' });
    updateProjectStatus.run({ id: projectId, status: 'dev' });
    send('progress', { message: 'HTML actualizado. Vuelve a ejecutar QA completo antes de desplegar.' });
    send('done', { data: currentData });
    return;

    const devPhase = getPhase(projectId, 'dev');
    const prevData = devPhase?.output ? JSON.parse(devPhase.output) : {};
    const specPhase = getPhase(projectId, 'spec');
    const spec = specPhase?.output ? JSON.parse(specPhase.output) : {};

    send('progress', { message: 'Agente Developer refinando código...' });
    updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'running', output: devPhase?.output || '', notes: '' });

    const legacyFeedback = req.body.feedback || '';

    // Mensaje de feedback intermedio para que el usuario sepa que la generación es pesada
    setTimeout(() => {
      send('progress', { message: 'El modelo está generando los archivos. Esto puede tardar unos segundos debido al volumen de código...' });
    }, 5000);

    const result = await developer({
      spec,
      task: `Aplica un rediseño que rompa con la estructura actual basado en: "${feedback}".
      - Busca una estética que diferencie totalmente a "${project.name}" de cualquier diseño genérico.
      - Si el diseño actual se siente repetitivo, cambia la estructura de las secciones, los pesos visuales y la paleta de colores.
      - Propón una dirección de arte específica que encaje con el resumen: "${project.summary}".
      - Evita caer en los mismos recursos de diseño (como el exceso de glassmorphism) si no aportan valor único aquí.
      IMPORTANTE: No te limites por el código anterior. Si es aburrido, bórralo y crea algo nuevo desde cero que sea visualmente asombroso.`,
      context: `Iteración de rediseño radical. El usuario odia el diseño plano. Usa gradientes, capas, sombras y efectos premium.`,
      projectId,
      projectName: project.name
    });

    if (result.success) {
      send('progress', { message: `${result.data.files?.length || 0} archivos actualizados` });
      updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(result.data), notes: `Refinado: ${feedback}` });
      send('done', { data: result.data });
    } else {
      updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'error', output: JSON.stringify({ error: result.error }), notes: result.error });
      send('error', { error: result.error });
    }
  } catch (err) {
    try {
      const devPhase = getPhase(projectId, 'dev');
      if (devPhase?.output) {
        updatePhase.run({
          project_id: projectId,
          phase_key: 'dev',
          status: 'done',
          output: devPhase.output,
          notes: `Refinado no aplicado: ${err.message}`
        });
      }
    } catch { }
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// ─── Settings — muestra qué claves API están configuradas ────────────────────
app.get('/api/pipeline/:id/sections', (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const project = getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const devPhase = getPhase(projectId, 'dev');
    const devData = parsePhaseOutput(devPhase);
    const htmlFile = getPrimaryHtmlFile(devData);
    if (!htmlFile?.code) return res.status(404).json({ error: 'No hay HTML generado para revisar' });

    const sections = extractLandingParts(htmlFile.code).map(({ start, end, ...part }) => part);
    res.json({ success: true, projectId, projectName: project.name, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pipeline/:id/sections/:sectionIndex/refine', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const sectionIndex = Number(req.params.sectionIndex);
    const prompt = String(req.body.prompt || '').trim();
    const mode = req.body.mode === 'visual' ? 'visual' : 'copy';
    if (!prompt) return res.status(400).json({ error: 'Prompt requerido' });

    const project = getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const devPhase = getPhase(projectId, 'dev');
    const devData = parsePhaseOutput(devPhase);
    const htmlFile = getPrimaryHtmlFile(devData);
    if (!htmlFile?.code) return res.status(404).json({ error: 'No hay HTML generado para revisar' });

    const parts = extractLandingParts(htmlFile.code);
    const part = parts[sectionIndex];
    if (!part) return res.status(404).json({ error: 'Seccion no encontrada' });

    const compactHtml = part.html.length > 6000
      ? `${part.html.slice(0, 3000)}\n<!-- contenido intermedio omitido para acelerar la regeneracion -->\n${part.html.slice(-2500)}`
      : part.html;

    const system = `Eres un senior frontend engineer y product designer. Regeneras solo un bloque HTML de una landing existente.
Devuelve UNICAMENTE JSON valido con la forma:
{"html":"<section ...>...</section>","notes":"resumen corto"}
Reglas:
- Manten el mismo tipo de etiqueta raiz del bloque original (${part.type}).
- No devuelvas <html>, <head>, <body> ni markdown.
- Conserva IDs usados por navegacion cuando existan.
- Usa clases/estilo compatibles con el HTML existente.
- El cambio debe ser visible. No devuelvas la misma seccion sin cambios.
${mode === 'visual' ? `- PRIORIDAD: rediseño visual. Cambia layout interno, jerarquia, composicion, cards, agrupaciones, ritmo visual y detalles CSS inline o clases existentes.
- Mantén el contenido esencial, pero cambia la presentacion de forma clara.
- Puedes añadir wrappers, grids, listas, badges, microcopy y estilos inline puntuales dentro de esta seccion.
- No te limites a cambiar textos.` : `- PRIORIDAD: mejora copy, claridad y conversion sin romper el layout actual.`}`;

    const user = `Proyecto: ${project.name}
Resumen: ${project.summary || ''}
Parte actual: ${part.label}
Modo: ${mode === 'visual' ? 'rediseño visual de la seccion' : 'mejora de copy/contenido'}
Prompt del usuario: ${prompt}

HTML actual de la parte:
${compactHtml}`;

    let parsed;
    let providerNote = '';
    try {
      const ai = await withTimeout(
        smartChat('developer', system, user, mode === 'visual' ? 1400 : 1000),
        180000,
        'La regeneracion tardo demasiado. Prueba con una instruccion mas concreta o revisa LM Studio/Groq.'
      );
      parsed = parseSectionHtmlResponse(ai.text, part.type);
      providerNote = `Seccion refinada con ${ai.provider}`;
    } catch (err) {
      parsed = {
        html: buildLocalSectionFallback(part, prompt, mode),
        notes: `Fallback local aplicado porque el proveedor fallo: ${err.message}`
      };
      providerNote = parsed.notes;
    }
    const nextHtml = parsed?.html?.trim();
    if (!nextHtml || !new RegExp(`^<${part.type}\\b`, 'i').test(nextHtml)) {
      return res.status(502).json({
        error: 'El modelo no devolvio un bloque HTML valido para esta seccion. Prueba con un prompt mas directo o usa edicion manual.'
      });
    }
    if (normalizeHtmlForCompare(nextHtml) === normalizeHtmlForCompare(part.html)) {
      return res.status(409).json({
        error: 'El modelo devolvio la misma seccion sin cambios. Prueba con una instruccion mas concreta o cambia los textos con Edicion sin codigo.'
      });
    }

    const updatedHtml = htmlFile.code.slice(0, part.start) + nextHtml + htmlFile.code.slice(part.end);
    htmlFile.code = updatedHtml;
    devData.workspace_path = writeProjectFilesToWorkspace(project, devData.files);
    devData.notes = `${devData.notes || ''}\nRefinado de seccion "${part.label}": ${prompt}`.trim();

    updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(devData), notes: `Seccion refinada: ${part.label}` });
    updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'active', output: '', notes: 'Pendiente tras refinado de seccion' });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'pending', output: '', notes: '' });
    updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'pending', output: '', notes: '' });
    updateProjectStatus.run({ id: projectId, status: 'dev' });

    const sections = extractLandingParts(updatedHtml).map(({ start, end, ...p }) => p);
    res.json({
      success: true,
      section: sections[sectionIndex] || null,
      sections,
      notes: parsed.notes || providerNote
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pipeline/:id/sections/:sectionIndex', (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const sectionIndex = Number(req.params.sectionIndex);
    const html = String(req.body.html || '').trim();
    const fields = Array.isArray(req.body.fields) ? req.body.fields : null;
    if (!html && !fields?.length) return res.status(400).json({ error: 'Contenido requerido' });

    const project = getProjectById(projectId);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const devPhase = getPhase(projectId, 'dev');
    const devData = parsePhaseOutput(devPhase);
    const htmlFile = getPrimaryHtmlFile(devData);
    if (!htmlFile?.code) return res.status(404).json({ error: 'No hay HTML generado para revisar' });

    const parts = extractLandingParts(htmlFile.code);
    const part = parts[sectionIndex];
    if (!part) return res.status(404).json({ error: 'Seccion no encontrada' });
    const nextHtml = fields?.length ? applyEditableFields(part.html, fields) : html;
    if (!new RegExp(`^<${part.type}\\b`, 'i').test(nextHtml)) {
      return res.status(400).json({ error: `La seccion debe empezar con <${part.type}> para no romper la estructura` });
    }

    const updatedHtml = htmlFile.code.slice(0, part.start) + nextHtml + htmlFile.code.slice(part.end);
    htmlFile.code = updatedHtml;
    devData.workspace_path = writeProjectFilesToWorkspace(project, devData.files);
    devData.notes = `${devData.notes || ''}\nEdicion manual de seccion "${part.label}"`.trim();

    updatePhase.run({ project_id: projectId, phase_key: 'dev', status: 'done', output: JSON.stringify(devData), notes: `Seccion editada manualmente: ${part.label}` });
    updatePhase.run({ project_id: projectId, phase_key: 'test', status: 'active', output: '', notes: 'Pendiente tras edicion manual de seccion' });
    updatePhase.run({ project_id: projectId, phase_key: 'deploy', status: 'pending', output: '', notes: '' });
    updatePhase.run({ project_id: projectId, phase_key: 'live', status: 'pending', output: '', notes: '' });
    updateProjectStatus.run({ id: projectId, status: 'dev' });

    const sections = extractLandingParts(updatedHtml).map(({ start, end, ...p }) => p);
    res.json({ success: true, section: sections[sectionIndex] || null, sections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', (_, res) => {
  const keys = [
    'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'TAVILY_API_KEY',
    'VERCEL_TOKEN', 'GITHUB_TOKEN', 'OBSIDIAN_API_KEY', 'OBSIDIAN_PORT',
    'LM_STUDIO_URL', 'OLLAMA_BASE_URL', 'LM_STUDIO_TIMEOUT',
    'LM_MODEL_ARCHITECT', 'LM_MODEL_DEVELOPER'
  ];
  const settings = {};
  for (const k of keys) {
    const v = process.env[k];
    settings[k] = v ? (k.includes('KEY') || k.includes('TOKEN') ? '***' + v.slice(-4) : v) : null;
  }
  res.json(settings);
});

// Guardar una key en .env en tiempo real
app.post('/api/settings', (req, res) => {
  const ALLOWED = ['OBSIDIAN_API_KEY', 'OBSIDIAN_PORT', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'GROQ_API_KEY', 'TAVILY_API_KEY'];
  const { key, value } = req.body;
  if (!ALLOWED.includes(key)) return res.status(400).json({ error: 'Key no permitida' });

  const envPath = path.resolve(process.cwd(), '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content);
  process.env[key] = value;
  res.json({ ok: true });
});

// ─── Obsidian ─────────────────────────────────────────────────────────────────
app.get('/api/obsidian/test', async (_, res) => {
  const key = process.env.OBSIDIAN_API_KEY;
  const port = process.env.OBSIDIAN_PORT || 27123;
  if (!key) return res.json({ connected: false, reason: 'OBSIDIAN_API_KEY no configurada' });
  const axiosInst = (await import('axios')).default;
  // Probar HTTP y HTTPS
  for (const proto of ['http', 'https']) {
    try {
      const r = await axiosInst.get(`${proto}://localhost:${port}/`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 3000,
        httpsAgent: proto === 'https' ? new (await import('https')).Agent({ rejectUnauthorized: false }) : undefined
      });
      return res.json({ connected: true, vault: r.data?.vault || r.data || 'OK', proto });
    } catch (err) {
      const detail = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
      console.log(`[Obsidian] ${proto} falló:`, detail);
      if (proto === 'https') return res.json({ connected: false, reason: detail });
    }
  }
});

app.post('/api/pipeline/:id/obsidian', async (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
  const { syncToObsidian } = await import('./services/obsidiansync.js');
  const { exportProjectToObsidian } = await import('./export.js');
  const { filename, content } = await exportProjectToObsidian(req.params.id);
  const result = await syncToObsidian({
    title: filename.replace('.md', ''),
    content,
    folder: 'Nexus/Projects',
    tags: `nexus-project, ${project.status}`
  });
  res.json(result);
});

// ─── GitHub — crear repo y push del workspace ─────────────────────────────────
app.post('/api/github/create-repo', async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(400).json({ error: 'GITHUB_TOKEN no configurado en .env' });

  const { projectId, repoName, description = '', isPrivate = true } = req.body;
  if (!repoName) return res.status(400).json({ error: 'repoName requerido' });

  try {
    const { default: axios } = await import('axios');
    const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };

    // 1. Crear el repo en GitHub
    const { data: repo } = await axios.post('https://api.github.com/user/repos', {
      name: repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      description,
      private: isPrivate,
      auto_init: false
    }, { headers });

    // 2. Si hay proyecto, leer archivos del workspace y hacer push via API
    if (projectId) {
      const project = getProjectById(Number(projectId));
      const safeName = (project?.name || repoName).toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 50);
      const wsPath = path.join(ROOT, 'workspace', safeName);

      if (fs.existsSync(wsPath)) {
        const pushFile = async (filePath, content) => {
          const relPath = path.relative(wsPath, filePath).replace(/\\/g, '/');
          await axios.put(`https://api.github.com/repos/${repo.full_name}/contents/${relPath}`, {
            message: `feat: add ${relPath} via Nexus Brain`,
            content: Buffer.from(content).toString('base64')
          }, { headers }).catch(() => { }); // ignorar errores por archivo individual
        };

        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
              try { pushFile(full, fs.readFileSync(full, 'utf8')); } catch { }
            }
          }
        };
        walk(wsPath);
      }

      // Guardar URL en el proyecto
      db.prepare('UPDATE projects SET github_url=? WHERE id=?').run(repo.html_url, Number(projectId));
    }

    res.json({ success: true, url: repo.html_url, fullName: repo.full_name });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─── Export pipeline como Markdown ───────────────────────────────────────────
app.get('/api/pipeline/:id/export', (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const phases = getPhases(Number(req.params.id));
  const STATUS_ICON = { done: '✅', active: '🔵', running: '⏳', error: '❌', pending: '⬜' };

  let md = `# ${project.name}\n\n`;
  md += `> ${project.summary || ''}\n\n`;
  let stackDisplay = 'Por definir';
  if (project.stack) {
    try { stackDisplay = JSON.parse(project.stack)?.frontend?.core || project.stack; }
    catch { stackDisplay = project.stack; }
  }
  md += `**Stack:** ${stackDisplay}  \n`;
  md += `**Estado:** ${project.status}  \n`;
  md += `**Creado:** ${new Date(project.created_at).toLocaleDateString('es-ES')}\n\n---\n\n`;

  for (const phase of phases) {
    const icon = STATUS_ICON[phase.status] || '⬜';
    md += `## ${icon} Fase ${phase.phase_num}: ${phase.phase_key.toUpperCase()}\n\n`;
    if (phase.notes) md += `**Notas:** ${phase.notes}\n\n`;
    if (phase.output) {
      try {
        const out = JSON.parse(phase.output);
        if (phase.phase_key === 'spec' && out.vision) {
          md += `**Visión:** ${out.vision}\n\n`;
          if (out.features?.length) {
            md += `### Features\n`;
            out.features.forEach(f => { md += `- **${f.name}** (${f.priority}): ${f.description}\n`; });
            md += '\n';
          }
        }
        if (phase.phase_key === 'dev' && out.files?.length) {
          md += `### Archivos generados (${out.files.length})\n`;
          out.files.forEach(f => { md += `- \`${f.path}\` — ${f.description || f.language}\n`; });
          if (out.workspace_path) md += `\n**Workspace:** \`${out.workspace_path}\`\n`;
          md += '\n';
        }
        if (phase.phase_key === 'deploy' && (out.projectUrl || out.deployUrl)) {
          md += `**URL:** ${out.projectUrl || out.deployUrl}\n\n`;
        }
        if (phase.phase_key === 'test') {
          if (out.status) md += `**Resultado:** ${out.status} | Bugs: ${out.bugs ?? 0} | Cobertura: ${out.coverage || 'N/A'}\n\n`;
        }
      } catch { }
    }
  }

  md += `\n---\n*Exportado desde Nexus Brain · ${new Date().toLocaleString('es-ES')}*\n`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, '-')}-pipeline.md"`);
  res.send(md);
});

// ─── Export workspace como ZIP ────────────────────────────────────────────────
app.get('/api/pipeline/:id/export-zip', async (req, res) => {
  const project = getProjectById(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const safeName = (project.name || `project-${req.params.id}`)
    .toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 50);
  const wsPath = path.resolve(process.cwd(), 'workspace', safeName);

  if (!fs.existsSync(wsPath)) {
    return res.status(404).json({ error: 'El workspace no existe aún. Ejecuta la fase de desarrollo primero.' });
  }

  const { default: archiver } = await import('archiver');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  archive.pipe(res);
  archive.directory(wsPath, safeName);
  archive.finalize();
});

// ─── Stripe Billing ───────────────────────────────────────────────────────────

app.post('/api/billing/checkout', async (req, res) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (!secret) return res.status(400).json({ error: 'Stripe no configurado. Añade STRIPE_SECRET_KEY al .env' });
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secret);
  const user = getUserById(req.user.id);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    metadata: { userId: String(req.user.id) },
    success_url: `${appUrl}?upgrade=success`,
    cancel_url: `${appUrl}?upgrade=cancelled`,
  });
  res.json({ url: session.url });
});

app.post('/api/billing/portal', async (req, res) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (!secret) return res.status(400).json({ error: 'Stripe no configurado' });
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secret);

  const user = getUserById(req.user.id);
  const customers = await stripe.customers.list({ email: user.email, limit: 1 });
  if (!customers.data.length) return res.status(404).json({ error: 'Cliente Stripe no encontrado' });

  const session = await stripe.billingPortal.sessions.create({
    customer: customers.data[0].id,
    return_url: appUrl,
  });
  res.json({ url: session.url });
});

app.get('/api/billing/status', (req, res) => {
  const user = getUserById(req.user.id);
  const { used, limit } = checkRunLimit(user);
  res.json({ plan: user.plan, runs_used: used, limit, stripe_configured: !!process.env.STRIPE_SECRET_KEY });
});

const server = app.listen(PORT, () => {
  console.log(`\n🧠 Nexus Brain Server running on http://localhost:${PORT}`);
  console.log(`   Agents: Orchestrator · Capture · Classifier · Memory · Projects · Writer · Researcher · Architect · Developer · Deploy\n`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: El puerto ${PORT} ya está en uso.`);
    console.error(`   1. Cierra otras instancias de Nexus Brain.`);
    console.error(`   2. O cambia el puerto: 'set PORT=3003 && npm start'`);
    console.error(`   3. O mata el proceso: 'Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force' en PowerShell.\n`);
    process.exit(1);
  } else {
    console.error('Error al iniciar el servidor:', e);
  }
});
