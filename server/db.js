import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

// ─── Init tables ─────────────────────────────────────────────────────────────

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS captures (
      id SERIAL PRIMARY KEY,
      title TEXT,
      summary TEXT,
      type TEXT,
      tags TEXT,
      content TEXT,
      embedding TEXT,
      raw TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS memory_queries (
      id SERIAL PRIMARY KEY,
      question TEXT,
      answer TEXT,
      confidence REAL,
      sources TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT,
      summary TEXT,
      stack TEXT,
      features TEXT,
      phases TEXT,
      spec TEXT,
      status TEXT DEFAULT 'planning',
      github_url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS research_cache (
      id SERIAL PRIMARY KEY,
      query_hash TEXT UNIQUE,
      query TEXT,
      depth TEXT DEFAULT 'basic',
      result TEXT,
      sources TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS dev_sessions (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id),
      task TEXT,
      files TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deploys (
      id SERIAL PRIMARY KEY,
      project_name TEXT,
      deploy_url TEXT,
      project_url TEXT,
      status TEXT,
      files_count INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_phases (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      phase_num INTEGER NOT NULL,
      phase_key TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      output TEXT,
      notes TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      plan TEXT DEFAULT 'free',
      runs_used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used INTEGER DEFAULT 0
    );
  `);
}

// ─── Users / Auth ─────────────────────────────────────────────────────────────

export async function createUser({ email, password_hash, name }) {
  const r = await query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *',
    [email, password_hash, name]
  );
  return r.rows[0];
}

export async function getUserByEmail(email) {
  const r = await query('SELECT * FROM users WHERE email = $1', [email]);
  return r.rows[0] || null;
}

export async function getUserById(id) {
  const r = await query(
    'SELECT id, email, name, plan, runs_used, created_at FROM users WHERE id = $1',
    [id]
  );
  return r.rows[0] || null;
}

export async function incrementUserRuns(id) {
  await query('UPDATE users SET runs_used = runs_used + 1 WHERE id = $1', [id]);
}

export async function updateUserPlan(id, plan) {
  await query('UPDATE users SET plan = $1 WHERE id = $2', [plan, id]);
}

export async function resetMonthlyRuns(id) {
  await query('UPDATE users SET runs_used = 0 WHERE id = $1', [id]);
}

export async function createResetToken({ user_id, token }) {
  await query(
    "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
    [user_id, token]
  );
}

export async function getResetToken(token) {
  const r = await query(
    "SELECT * FROM password_resets WHERE token=$1 AND used=0 AND expires_at > NOW()",
    [token]
  );
  return r.rows[0] || null;
}

export async function markTokenUsed(token) {
  await query('UPDATE password_resets SET used=1 WHERE token=$1', [token]);
}

export async function updateUserPassword(id, hash) {
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
}

export const PLAN_LIMITS = { free: 15, pro: Infinity };

export function checkRunLimit(user) {
  const limit = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS.free;
  return { allowed: user.runs_used < limit, used: user.runs_used, limit };
}

export async function countUsers() {
  const r = await query('SELECT COUNT(*) as n FROM users');
  return parseInt(r.rows[0].n);
}

// ─── Captures ────────────────────────────────────────────────────────────────

export async function saveCapture({ title, summary, type, tags, content, embedding, raw }) {
  const r = await query(
    'INSERT INTO captures (title, summary, type, tags, content, embedding, raw) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [title, summary, type, tags, content, embedding, raw]
  );
  return r.rows[0];
}

export async function updateCaptureEmbedding(id, embedding) {
  await query('UPDATE captures SET embedding=$1 WHERE id=$2', [embedding, id]);
}

export async function getCaptures(limit = 50) {
  const r = await query('SELECT * FROM captures ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

export async function searchCaptures(q) {
  const r = await query(
    "SELECT * FROM captures WHERE title ILIKE $1 OR summary ILIKE $1 OR tags ILIKE $1 ORDER BY created_at DESC LIMIT 30",
    [`%${q}%`]
  );
  return r.rows;
}

export async function searchMemoryFTS(q) {
  return searchCaptures(q);
}

export async function searchSemantic(queryVector, limit = 5) {
  const r = await query('SELECT id, title, summary, content, type, embedding FROM captures WHERE embedding IS NOT NULL');
  const allCaptures = r.rows;
  const scored = allCaptures.map(cap => {
    const capVector = JSON.parse(cap.embedding);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < queryVector.length; i++) {
      dot += queryVector[i] * capVector[i];
      magA += queryVector[i] ** 2;
      magB += capVector[i] ** 2;
    }
    return { ...cap, similarity: dot / (Math.sqrt(magA) * Math.sqrt(magB)) };
  });
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// ─── Memory queries ───────────────────────────────────────────────────────────

export async function saveMemoryQuery({ question, answer, confidence, sources }) {
  await query(
    'INSERT INTO memory_queries (question, answer, confidence, sources) VALUES ($1,$2,$3,$4)',
    [question, answer, confidence, sources]
  );
}

export async function getMemoryQueries(limit = 20) {
  const r = await query('SELECT * FROM memory_queries ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function saveProject({ name, summary, stack, features, phases, spec, github_url }) {
  const r = await query(
    'INSERT INTO projects (name, summary, stack, features, phases, spec, github_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [name, summary, stack, features, phases, spec, github_url]
  );
  return r.rows[0];
}

export async function getProjects(limit = 10) {
  const r = await query('SELECT * FROM projects ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

export async function getProjectById(id) {
  const r = await query('SELECT * FROM projects WHERE id = $1', [id]);
  return r.rows[0] || null;
}

export async function getProjectTasks(projectId) {
  const project = await getProjectById(projectId);
  return project ? JSON.parse(project.features || '[]') : [];
}

export async function updateProjectFeatures(id, features) {
  await query('UPDATE projects SET features=$1 WHERE id=$2', [features, id]);
}

export async function updateProjectStatus(id, status) {
  await query('UPDATE projects SET status=$1 WHERE id=$2', [status, id]);
}

export async function getProjectsWithPhases(limit = 50) {
  const r = await query('SELECT * FROM projects ORDER BY created_at DESC LIMIT $1', [limit]);
  const projects = r.rows;
  for (const p of projects) {
    const ph = await query('SELECT * FROM project_phases WHERE project_id=$1 ORDER BY phase_num', [p.id]);
    p.phases = ph.rows;
  }
  return projects;
}

// ─── Project phases ───────────────────────────────────────────────────────────

export async function insertPhase({ project_id, phase_num, phase_key }) {
  await query(
    "INSERT INTO project_phases (project_id, phase_num, phase_key, status) VALUES ($1,$2,$3,'pending')",
    [project_id, phase_num, phase_key]
  );
}

export async function updatePhase({ project_id, phase_key, status, output, notes }) {
  await query(
    'UPDATE project_phases SET status=$1, output=$2, notes=$3, updated_at=NOW() WHERE project_id=$4 AND phase_key=$5',
    [status, output, notes, project_id, phase_key]
  );
}

export async function getPhases(projectId) {
  const r = await query('SELECT * FROM project_phases WHERE project_id=$1 ORDER BY phase_num', [projectId]);
  return r.rows;
}

export async function getPhase(projectId, phaseKey) {
  const r = await query('SELECT * FROM project_phases WHERE project_id=$1 AND phase_key=$2', [projectId, phaseKey]);
  return r.rows[0] || null;
}

// ─── Dev sessions / Deploys ───────────────────────────────────────────────────

export async function saveDevSession({ project_id, task, files, notes }) {
  await query(
    'INSERT INTO dev_sessions (project_id, task, files, notes) VALUES ($1,$2,$3,$4)',
    [project_id, task, files, notes]
  );
}

export async function getDevSessions(limit = 20) {
  const r = await query('SELECT * FROM dev_sessions ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

export async function saveDeploy({ project_name, deploy_url, project_url, status, files_count }) {
  await query(
    'INSERT INTO deploys (project_name, deploy_url, project_url, status, files_count) VALUES ($1,$2,$3,$4,$5)',
    [project_name, deploy_url, project_url, status, files_count]
  );
}

export async function getDeploys(limit = 20) {
  const r = await query('SELECT * FROM deploys ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

// ─── Research cache ───────────────────────────────────────────────────────────

export async function saveResearchCache({ query_hash, query: q, depth, result, sources }) {
  await query(
    'INSERT INTO research_cache (query_hash, query, depth, result, sources) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (query_hash) DO UPDATE SET result=$4, sources=$5, created_at=NOW()',
    [query_hash, q, depth, result, sources]
  );
}

export async function getResearchCache(queryHash, maxAgeHours = 24) {
  const r = await query(
    "SELECT * FROM research_cache WHERE query_hash=$1 AND created_at > NOW() - ($2 || ' hours')::INTERVAL ORDER BY created_at DESC LIMIT 1",
    [queryHash, maxAgeHours]
  );
  return r.rows[0] || null;
}

export async function getRecentResearches(limit = 10) {
  const r = await query('SELECT id, query, depth, created_at FROM research_cache ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getStats() {
  const [c, p, d, m, s] = await Promise.all([
    query('SELECT COUNT(*) as n FROM captures'),
    query('SELECT COUNT(*) as n FROM projects'),
    query('SELECT COUNT(*) as n FROM deploys'),
    query('SELECT COUNT(*) as n FROM memory_queries'),
    query('SELECT COUNT(*) as n FROM dev_sessions'),
  ]);
  return {
    captures: parseInt(c.rows[0].n),
    projects: parseInt(p.rows[0].n),
    deploys: parseInt(d.rows[0].n),
    memoryQueries: parseInt(m.rows[0].n),
    devSessions: parseInt(s.rows[0].n),
  };
}

export default pool;
