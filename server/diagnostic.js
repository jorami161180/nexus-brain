import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', 'nexus.db'));

const report = [];
report.push('--- DB DUMP REPORT ---');

try {
  const captures = db.prepare('SELECT * FROM captures').all();
  report.push(`Captures found: ${captures.length}`);
  captures.forEach(c => {
    let embeddingStatus = '❌ No embedding';
    if (c.embedding) {
      try {
        const vector = JSON.parse(c.embedding);
        embeddingStatus = `✅ Embedding (${vector.length} dimensiones)`;
      } catch (e) {
        embeddingStatus = '⚠️ Error en formato JSON';
      }
    }
    report.push(`[${c.type}] ${c.title}: ${embeddingStatus}`);
  });
} catch (e) {
  report.push(`Error reading captures: ${e.message}`);
}

try {
  const queries = db.prepare('SELECT * FROM memory_queries').all();
  report.push(`\nMemory Queries found: ${queries.length}`);
} catch (e) {
  report.push(`Error reading queries: ${e.message}`);
}

fs.writeFileSync(join(__dirname, '..', 'db_report.txt'), report.join('\n'));
console.log('Report saved to db_report.txt');
