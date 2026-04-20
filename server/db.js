import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, '..', 'nexus.db');
const db = new Database(dbPath);

// Optimizaciones
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Tablas ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS captures (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT,
    summary   TEXT,
    type      TEXT,
    tags      TEXT,
    content   TEXT,
    embedding TEXT,
    raw       TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memory_queries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    question   TEXT,
    answer     TEXT,
    confidence REAL,
    sources    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT,
    summary    TEXT,
    stack      TEXT,
    features   TEXT,
    phases     TEXT,
    spec       TEXT,
    status     TEXT DEFAULT 'planning',
    github_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Asegurar columnas críticas antes de preparar statements
const columns = db.prepare("PRAGMA table_info(captures)").all();
if (!columns.find(c => c.name === 'embedding')) {
  db.exec('ALTER TABLE captures ADD COLUMN embedding TEXT;');
  console.log('✅ Columna "embedding" añadida a captures.');
}

const projectCols = db.prepare("PRAGMA table_info(projects)").all();
if (!projectCols.find(c => c.name === 'github_url')) {
  db.exec('ALTER TABLE projects ADD COLUMN github_url TEXT;');
  console.log('✅ Columna "github_url" añadida a projects.');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS research_cache (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash TEXT UNIQUE,
    query      TEXT,
    depth      TEXT DEFAULT 'basic',
    result     TEXT,
    sources    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS dev_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    task       TEXT,
    files      TEXT,
    notes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deploys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name  TEXT,
    deploy_url    TEXT,
    project_url   TEXT,
    status        TEXT,
    files_count   INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_phases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    phase_num  INTEGER NOT NULL,
    phase_key  TEXT NOT NULL,
    status     TEXT DEFAULT 'pending',
    output     TEXT,
    notes      TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tabla virtual FTS5 para búsqueda semántica/full-text
  CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
    title, summary, tags, content, raw,
    content='captures', content_rowid='id'
  );

  -- Triggers para auto-sincronizar FTS5 cuando cambie captures
  CREATE TRIGGER IF NOT EXISTS captures_ai AFTER INSERT ON captures BEGIN
    INSERT INTO captures_fts(rowid, title, summary, tags, content, raw)
    VALUES (new.id, new.title, new.summary, new.tags, new.content, new.raw);
  END;
  CREATE TRIGGER IF NOT EXISTS captures_ad AFTER DELETE ON captures BEGIN
    INSERT INTO captures_fts(captures_fts, rowid, title, summary, tags, content, raw)
    VALUES ('delete', old.id, old.title, old.summary, old.tags, old.content, old.raw);
  END;
  CREATE TRIGGER IF NOT EXISTS captures_au AFTER UPDATE ON captures BEGIN
    INSERT INTO captures_fts(captures_fts, rowid, title, summary, tags, content, raw)
    VALUES ('delete', old.id, old.title, old.summary, old.tags, old.content, old.raw);
    INSERT INTO captures_fts(rowid, title, summary, tags, content, raw)
    VALUES (new.id, new.title, new.summary, new.tags, new.content, new.raw);
  END;
`);

// Popular FTS con datos preexistentes si no están indexados
try {
  db.exec('INSERT INTO captures_fts(rowid, title, summary, tags, content, raw) SELECT id, title, summary, tags, content, raw FROM captures WHERE id NOT IN (SELECT rowid FROM captures_fts);');
} catch (e) {
  // Ignorar errores de consistencia en el primer run
}

// ─── Users / Auth ─────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name         TEXT,
    plan         TEXT DEFAULT 'free',
    runs_used    INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export const createUser = db.prepare(`
  INSERT INTO users (email, password_hash, name) VALUES (@email, @password_hash, @name)
`);

export const getUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(email);

export const getUserById = (id) =>
  db.prepare('SELECT id, email, name, plan, runs_used, created_at FROM users WHERE id = ?').get(id);

export const incrementUserRuns = db.prepare(`
  UPDATE users SET runs_used = runs_used + 1 WHERE id = @id
`);

export const updateUserPlan = db.prepare(`
  UPDATE users SET plan = @plan WHERE id = @id
`);

export const resetMonthlyRuns = db.prepare(`
  UPDATE users SET runs_used = 0 WHERE id = @id
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    token     TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    used      INTEGER DEFAULT 0
  );
`);

export const createResetToken = db.prepare(`
  INSERT INTO password_resets (user_id, token, expires_at)
  VALUES (@user_id, @token, datetime('now', '+1 hour'))
`);

export const getResetToken = (token) =>
  db.prepare(`SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at > datetime('now')`).get(token);

export const markTokenUsed = db.prepare(`UPDATE password_resets SET used=1 WHERE token=@token`);

export const updateUserPassword = db.prepare(`UPDATE users SET password_hash=@hash WHERE id=@id`);

export const PLAN_LIMITS = { free: 15, pro: Infinity };

export function checkRunLimit(user) {
  const limit = PLAN_LIMITS[user.plan] ?? PLAN_LIMITS.free;
  return { allowed: user.runs_used < limit, used: user.runs_used, limit };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const saveCapture = db.prepare(`
  INSERT INTO captures (title, summary, type, tags, content, embedding, raw)
  VALUES (@title, @summary, @type, @tags, @content, @embedding, @raw)
`);

export const updateCaptureEmbedding = db.prepare(`
  UPDATE captures SET embedding = @embedding
  WHERE id = @id
`);

export const saveMemoryQuery = db.prepare(`
  INSERT INTO memory_queries (question, answer, confidence, sources)
  VALUES (@question, @answer, @confidence, @sources)
`);

export const saveProject = db.prepare(`
  INSERT INTO projects (name, summary, stack, features, phases, spec, github_url)
  VALUES (@name, @summary, @stack, @features, @phases, @spec, @github_url)
`);

export const saveDevSession = db.prepare(`
  INSERT INTO dev_sessions (project_id, task, files, notes)
  VALUES (@project_id, @task, @files, @notes)
`);

export const saveDeploy = db.prepare(`
  INSERT INTO deploys (project_name, deploy_url, project_url, status, files_count)
  VALUES (@project_name, @deploy_url, @project_url, @status, @files_count)
`);
export const updateProjectFeatures = db.prepare(`
  UPDATE projects SET features = @features WHERE id = @id
`);

export const insertPhase = db.prepare(`
  INSERT INTO project_phases (project_id, phase_num, phase_key, status)
  VALUES (@project_id, @phase_num, @phase_key, 'pending')
`);

export const updatePhase = db.prepare(`
  UPDATE project_phases SET status=@status, output=@output, notes=@notes, updated_at=CURRENT_TIMESTAMP
  WHERE project_id=@project_id AND phase_key=@phase_key
`);

export const updateProjectStatus = db.prepare(`
  UPDATE projects SET status=@status WHERE id=@id
`);

export const getPhases = (projectId) =>
  db.prepare('SELECT * FROM project_phases WHERE project_id=? ORDER BY phase_num').all(projectId);

export const getPhase = (projectId, phaseKey) =>
  db.prepare('SELECT * FROM project_phases WHERE project_id=? AND phase_key=?').get(projectId, phaseKey);

// Solo proyectos con fases del nuevo pipeline (idea/spec/dev/test/deploy/live)
export const getProjectsWithPhases = (limit = 50) => {
  const projects = db.prepare(`
    SELECT DISTINCT p.* FROM projects p
    LEFT JOIN project_phases ph ON ph.project_id = p.id
    ORDER BY p.created_at DESC LIMIT ?
  `).all(limit);
  return projects.map(p => ({
    ...p,
    phases: db.prepare('SELECT * FROM project_phases WHERE project_id=? ORDER BY phase_num').all(p.id)
  }));
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getCaptures = (limit = 50) =>
  db.prepare('SELECT * FROM captures ORDER BY created_at DESC LIMIT ?').all(limit);

export const getProjects = (limit = 10) => {
  return db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT ?').all(limit);
};

export const getProjectById = (id) => {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
};

export const getProjectTasks = (projectId) => {
  // En una versión futura podríamos tener una tabla de tareas dedicada. 
  // Por ahora devolvemos el campo features parseado.
  const project = getProjectById(projectId);
  return project ? JSON.parse(project.features || '[]') : [];
};

export const getDeploys = (limit = 20) =>
  db.prepare('SELECT * FROM deploys ORDER BY created_at DESC LIMIT ?').all(limit);

export const getMemoryQueries = (limit = 20) =>
  db.prepare('SELECT * FROM memory_queries ORDER BY created_at DESC LIMIT ?').all(limit);

export const getDevSessions = (limit = 20) =>
  db.prepare('SELECT * FROM dev_sessions ORDER BY created_at DESC LIMIT ?').all(limit);

// ─── Research cache ───────────────────────────────────────────────────────────
export const saveResearchCache = db.prepare(`
  INSERT OR REPLACE INTO research_cache (query_hash, query, depth, result, sources)
  VALUES (@query_hash, @query, @depth, @result, @sources)
`);

export const getResearchCache = (queryHash, maxAgeHours = 24) => {
  return db.prepare(`
    SELECT * FROM research_cache
    WHERE query_hash = ?
    AND created_at > datetime('now', '-${maxAgeHours} hours')
    ORDER BY created_at DESC LIMIT 1
  `).get(queryHash);
};

export const getRecentResearches = (limit = 10) =>
  db.prepare('SELECT id, query, depth, created_at FROM research_cache ORDER BY created_at DESC LIMIT ?').all(limit);

export const searchCaptures = (q) => {
  // Intentar FTS5 primero, fallback a LIKE si falla
  try {
    const keywords = q.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, ' ')
      .trim().split(/\s+/).filter(w => w.length > 2).map(w => w + '*').join(' OR ');
    if (keywords) {
      return db.prepare(`SELECT c.* FROM captures_fts f JOIN captures c ON f.rowid = c.id WHERE captures_fts MATCH ? ORDER BY rank LIMIT 30`).all(keywords);
    }
  } catch { /* fallback */ }
  return db.prepare("SELECT * FROM captures WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 30")
    .all(`%${q}%`, `%${q}%`, `%${q}%`);
};

/**
 * Búsqueda semántica usando Similitud de Coseno en JS
 */
export const searchSemantic = (queryVector, limit = 5) => {
  const allCaptures = db.prepare('SELECT id, title, summary, content, type, embedding FROM captures WHERE embedding IS NOT NULL').all();

  const scored = allCaptures.map(cap => {
    const capVector = JSON.parse(cap.embedding);
    // Similitud de coseno básica
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < queryVector.length; i++) {
      dotProduct += queryVector[i] * capVector[i];
      magA += queryVector[i] * queryVector[i];
      magB += capVector[i] * capVector[i];
    }
    const similarity = dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
    return { ...cap, similarity };
  });

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
};

export const searchMemoryFTS = (query, limit = 15) => {
  // Extraer palabras clave de más de 2 letras y formatear para FTS5 MATCH
  const keywords = query.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, ' ')
    .trim().split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w + '*')
    .join(' OR ');

  if (!keywords) return [];

  try {
    return db.prepare(`SELECT c.* FROM captures_fts f JOIN captures c ON f.rowid = c.id WHERE captures_fts MATCH ? ORDER BY rank LIMIT ?`).all(keywords, limit);
  } catch (err) {
    console.error('[DB] Error FTS5:', err.message);
    return [];
  }
};

export const getStats = () => ({
  captures: db.prepare('SELECT COUNT(*) as n FROM captures').get().n,
  projects: db.prepare('SELECT COUNT(*) as n FROM projects').get().n,
  deploys: db.prepare('SELECT COUNT(*) as n FROM deploys').get().n,
  memoryQueries: db.prepare('SELECT COUNT(*) as n FROM memory_queries').get().n,
  devSessions: db.prepare('SELECT COUNT(*) as n FROM dev_sessions').get().n,
});

export default db;
