import { createHash } from 'crypto';
import { smartChat } from '../router.js';
import { syncToObsidian } from '../services/obsidiansync.js';
import { saveCapture, saveResearchCache, getResearchCache } from '../db.js';
import axios from 'axios';

// ─── Sistema prompt enriquecido ───────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el Agente Investigador Senior del sistema Nexus Brain.
Transformas resultados de búsqueda en conocimiento estructurado y accionable.

RESPONDE ÚNICAMENTE con este JSON (sin markdown extra):
{
  "summary": "resumen ejecutivo de 3-5 líneas, denso en información",
  "key_findings": ["hallazgo concreto con dato específico", ...],
  "contradictions": ["fuente A dice X pero fuente B dice Y", ...],
  "action_items": ["acción concreta que el usuario puede tomar ahora", ...],
  "knowledge_gaps": ["pregunta específica sin responder", ...],
  "confidence": 0.0-1.0,
  "capture_worthy": true/false
}

DIRECTRICES:
- key_findings: mínimo 4, máximo 8. Cada uno debe contener un dato concreto.
- action_items: pasos que el usuario puede ejecutar, no genéricos.
- knowledge_gaps: preguntas que una segunda búsqueda debería responder.
- Si los resultados son contradictorios, documéntalo en contradictions.`;

// ─── Búsqueda con Tavily ──────────────────────────────────────────────────────
async function searchTavily(query, deep = false) {
  if (!process.env.TAVILY_API_KEY) return { results: [], answer: null };
  const { data } = await axios.post('https://api.tavily.com/search', {
    api_key:      process.env.TAVILY_API_KEY,
    query,
    search_depth: deep ? 'advanced' : 'basic',
    include_answer: true,
    max_results:  deep ? 8 : 5
  }, { timeout: 15000 });
  return { results: data.results || [], answer: data.answer };
}

// ─── DuckDuckGo HTML (versión normal) ────────────────────────────────────────
async function searchDDG(query) {
  const { data: html } = await axios.get('https://html.duckduckgo.com/html/', {
    params: { q: query, kl: 'es-es' },
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 10000
  });

  const results = [];
  const titleRe   = /class="result__a"[^>]*href="[^"]*uddg=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null)
    snippets.push(sm[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());

  let tm; let i = 0;
  while ((tm = titleRe.exec(html)) !== null && results.length < 6) {
    const url   = decodeURIComponent(tm[1]);
    const title = tm[2].replace(/<[^>]+>/g, '').trim();
    const isAd  = url.includes('y.js?') || url.includes('bing.com/aclick') || url.includes('ad_provider');
    if (title && url.startsWith('http') && !isAd)
      results.push({ title, url, content: snippets[i] || '', source: 'ddg' });
    i++;
  }
  return results;
}

// ─── DuckDuckGo Lite (HTML más simple, más difícil de bloquear) ──────────────
async function searchDDGLite(query) {
  const { data: html } = await axios.post('https://lite.duckduckgo.com/lite/',
    `q=${encodeURIComponent(query)}`,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      },
      timeout: 10000
    }
  );

  const results = [];
  // lite DDG: links en <a class="result-link">, snippets en <td class="result-snippet">
  const linkRe    = /<a class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

  const snippets = [];
  let sm;
  while ((sm = snippetRe.exec(html)) !== null)
    snippets.push(sm[1].replace(/<[^>]+>/g, '').trim());

  let lm; let i = 0;
  while ((lm = linkRe.exec(html)) !== null && results.length < 6) {
    const url   = lm[1];
    const title = lm[2].replace(/<[^>]+>/g, '').trim();
    if (title && url.startsWith('http'))
      results.push({ title, url, content: snippets[i] || '', source: 'ddg-lite' });
    i++;
  }
  return results;
}

// ─── Wikipedia API (gratis, sin key, siempre disponible) ─────────────────────
async function searchWikipedia(query, lang = 'es') {
  // 1. Buscar páginas relevantes
  const { data: search } = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
    params: {
      action: 'query', list: 'search', srsearch: query,
      srlimit: 3, format: 'json', origin: '*'
    },
    timeout: 8000
  });

  const pages = search.query?.search || [];
  if (!pages.length) return [];

  // 2. Obtener extracto de cada página
  const results = await Promise.allSettled(
    pages.map(p =>
      axios.get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.title)}`, {
        timeout: 5000
      }).then(r => ({
        title:   r.data.title,
        url:     r.data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        content: r.data.extract || '',
        source:  'wikipedia'
      }))
    )
  );

  return results
    .filter(r => r.status === 'fulfilled' && r.value.content)
    .map(r => r.value);
}

// ─── Scraping de páginas para modo deep ──────────────────────────────────────
async function scrapePages(urls, maxPerPage = 3000) {
  const results = await Promise.allSettled(
    urls.slice(0, 3).map(url =>
      axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 NexusBrain/2.0' },
        maxContentLength: 500000
      }).then(r => {
        const text = r.data
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, maxPerPage);
        return { url, text };
      })
    )
  );
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ─── Construir contexto para el LLM ──────────────────────────────────────────
function buildContext(results, tavilyAnswer, scrapedPages = []) {
  let ctx = '';
  if (tavilyAnswer) ctx += `RESPUESTA DIRECTA:\n${tavilyAnswer}\n\n`;

  ctx += results.map(r =>
    `FUENTE: ${r.title}\nURL: ${r.url}\n${r.content || r.snippet || ''}`
  ).join('\n\n---\n\n');

  if (scrapedPages.length) {
    ctx += '\n\n=== CONTENIDO COMPLETO DE PÁGINAS CLAVE ===\n\n';
    ctx += scrapedPages.map(p => `URL: ${p.url}\n${p.text}`).join('\n\n---\n\n');
  }
  return ctx;
}

// ─── Investigación iterativa (2 rondas) para modo deep ───────────────────────
async function iterativeResearch(query, firstResult, send) {
  const gaps = firstResult.knowledge_gaps || [];
  if (!gaps.length) return null;

  const followUpQuery = `${query} — ${gaps[0]}`;
  send('progress', { message: `Segunda ronda: "${gaps[0].slice(0, 60)}..."` });

  try {
    const { results: r2, answer: a2 } = await searchTavily(followUpQuery, false);
    if (!r2.length) return null;
    const ctx2 = buildContext(r2, a2);
    const { text } = await smartChat(
      'researcher',
      'Eres un investigador. Complementa estos hallazgos con el contexto adicional. Responde solo con JSON igual al anterior.',
      `Query original: "${query}"\nGap investigado: "${gaps[0]}"\n\nResultados adicionales:\n${ctx2}\n\nHallazgos previos:\n${JSON.stringify(firstResult)}`,
      2048
    );
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? { ...JSON.parse(json), _iterative: true, followUpSources: r2.map(r => ({ title: r.title, url: r.url })) } : null;
  } catch { return null; }
}

// ─── Export principal ─────────────────────────────────────────────────────────
export async function research(searchQuery, depth = 'basic', sync = true, send = () => {}) {
  const deep       = depth === 'deep';
  const queryHash  = createHash('md5').update(`${searchQuery}:${depth}`).digest('hex');

  // 1. Revisar caché (válida 12h para basic, 6h para deep)
  send('progress', { message: 'Revisando caché de investigaciones...' });
  const cached = getResearchCache(queryHash, deep ? 6 : 12);
  if (cached) {
    send('progress', { message: 'Resultado encontrado en caché' });
    return {
      success: true,
      data:    JSON.parse(cached.result),
      sources: JSON.parse(cached.sources || '[]'),
      provider: 'cache',
      fromCache: true
    };
  }

  // 2. Búsqueda web — Tavily (si hay key) → DuckDuckGo (gratis, sin key)
  send('progress', { message: `Buscando "${searchQuery}" en la web...` });
  let results = [];
  let tavilyAnswer = null;

  if (process.env.TAVILY_API_KEY) {
    try {
      const tavily = await searchTavily(searchQuery, deep);
      results = tavily.results;
      tavilyAnswer = tavily.answer;
      if (results.length) send('progress', { message: `${results.length} fuentes encontradas vía Tavily` });
    } catch (err) {
      send('progress', { message: 'Tavily falló, cambiando a DuckDuckGo...' });
    }
  }

  if (!results.length) {
    try {
      send('progress', { message: 'Buscando vía DuckDuckGo...' });
      results = await searchDDG(searchQuery);
      if (results.length) send('progress', { message: `${results.length} fuentes encontradas vía DuckDuckGo` });
    } catch (err) {
      send('progress', { message: `DuckDuckGo falló: ${err.message}. Probando DDG Lite...` });
    }
  }

  if (!results.length) {
    try {
      send('progress', { message: 'Buscando vía DuckDuckGo Lite...' });
      results = await searchDDGLite(searchQuery);
      if (results.length) send('progress', { message: `${results.length} fuentes encontradas vía DDG Lite` });
    } catch (err) {
      send('progress', { message: `DDG Lite falló: ${err.message}. Probando Wikipedia...` });
    }
  }

  if (!results.length) {
    try {
      send('progress', { message: 'Buscando vía Wikipedia...' });
      results = await searchWikipedia(searchQuery);
      if (results.length) send('progress', { message: `${results.length} artículos encontrados en Wikipedia` });
      else send('progress', { message: 'Sin resultados en Wikipedia. Usando conocimiento del modelo.' });
    } catch (err) {
      send('progress', { message: `Wikipedia falló: ${err.message}. Usando conocimiento del modelo.` });
    }
  }

  // 3. Scraping de páginas completas en modo deep
  let scrapedPages = [];
  if (deep && results.length) {
    send('progress', { message: 'Leyendo contenido completo de las páginas clave...' });
    scrapedPages = await scrapePages(results.slice(0, 3).map(r => r.url));
    if (scrapedPages.length) send('progress', { message: `${scrapedPages.length} páginas completas leídas` });
  }

  // 4. Síntesis con LLM
  send('progress', { message: 'Sintetizando con IA...' });
  const context = results.length
    ? buildContext(results, tavilyAnswer, scrapedPages)
    : null;

  const userMsg = context
    ? `Query: "${searchQuery}"\n\n${context}`
    : `Query: "${searchQuery}"\n\nNo hay resultados web. Usa tu conocimiento. Sé exhaustivo.`;

  let parsedData;
  try {
    const { text, provider } = await smartChat('researcher', SYSTEM_PROMPT, userMsg, deep ? 4096 : 2048);
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    parsedData = json
      ? JSON.parse(json)
      : { summary: text, key_findings: [], capture_worthy: false };
    parsedData._provider = provider;
  } catch (err) {
    return { success: false, error: err.message };
  }

  // 5. Segunda ronda iterativa en modo deep
  if (deep && parsedData.knowledge_gaps?.length) {
    send('progress', { message: 'Investigando gaps identificados...' });
    const followUp = await iterativeResearch(searchQuery, parsedData, send);
    if (followUp) {
      parsedData.key_findings  = [...new Set([...parsedData.key_findings, ...(followUp.key_findings || [])])];
      parsedData.action_items  = [...new Set([...(parsedData.action_items || []), ...(followUp.action_items || [])])];
      parsedData.knowledge_gaps = followUp.knowledge_gaps || [];
      parsedData._iterative    = true;
      if (followUp.followUpSources) results.push(...followUp.followUpSources.map(s => ({ ...s, content: '' })));
    }
  }

  const sources = results.map(r => ({ title: r.title, url: r.url, source: r.source || 'tavily' }));

  // 6. Guardar en caché
  await saveResearchCache({ query_hash: queryHash, query: searchQuery, depth, result: JSON.stringify(parsedData), sources: JSON.stringify(sources) });

  // 7. Guardar en DB local de captures si es relevante
  if (parsedData.capture_worthy) {
    try {
      await saveCapture({
        title:   `Investigación: ${searchQuery}`,
        summary: parsedData.summary,
        type:    'research',
        tags:    'investigación, ' + searchQuery.split(' ').slice(0, 3).join(', '),
        content: parsedData.key_findings.map(f => `- ${f}`).join('\n'),
        raw:     JSON.stringify(parsedData)
      });
      send('progress', { message: 'Guardado en base de conocimiento local' });
    } catch { /* no bloquear por error de DB */ }
  }

  // 8. Sync con Obsidian (no bloquea)
  if (sync && parsedData.capture_worthy) {
    const md = `# Investigación: ${searchQuery}
**Fecha:** ${new Date().toLocaleDateString('es-ES')}
**Profundidad:** ${depth} | **Confianza:** ${((parsedData.confidence || 0.7) * 100).toFixed(0)}%

## Resumen
${parsedData.summary}

## Hallazgos Clave
${(parsedData.key_findings || []).map(f => `- ${f}`).join('\n')}

## Acciones Recomendadas
${(parsedData.action_items || []).map(a => `- [ ] ${a}`).join('\n')}

## Fuentes
${sources.map(s => `- [${s.title}](${s.url})`).join('\n')}

---
*Nexus Brain · ${new Date().toLocaleString('es-ES')}*`;

    syncToObsidian({
      title:   `Research-${searchQuery.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
      content: md,
      folder:  'Nexus/Research',
      tags:    'investigación, nexus-brain'
    }).catch(() => {});
  }

  send('progress', { message: 'Investigación completada' });
  return { success: true, data: parsedData, sources, provider: parsedData._provider };
}
