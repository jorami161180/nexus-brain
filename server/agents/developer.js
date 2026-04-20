import fs from 'fs';
import path from 'path';
import { smartChat } from '../router.js';
import { saveDevSession } from '../db.js';

const TEMPLATES = {
  dark: path.resolve(process.cwd(), 'src/templates/landing.html'),
  minimal: path.resolve(process.cwd(), 'src/templates/landing-minimal.html'),
  bold: path.resolve(process.cwd(), 'src/templates/landing-bold.html'),
  pro: path.resolve(process.cwd(), 'src/templates/landing-pro.html'),
};

// El modelo genera CONTENIDO y elige el template que mejor encaje con el nicho
const CONTENT_SYSTEM = `Eres un copywriter y diseñador de producto senior. Tu trabajo es generar contenido ÚNICO, ESPECÍFICO y MEMORABLE para landing pages. NUNCA uses frases genéricas como "Aumenta tu productividad" o "Solución integral". Cada palabra debe sentirse escrita SOLO para este producto.

REGLAS DE CREATIVIDAD:
- hero_headline_1: frase corta de alto impacto (máx 5 palabras), evocadora, no obvia
- hero_headline_2: promesa específica con metáfora o giro sorprendente
- Elige colores que reflejen el nicho: fintech→azul eléctrico, salud→verde esmeralda, marketing→naranja/rojo, dev tools→verde terminal, AI→violeta/índigo, fitness→amarillo/negro, legal→azul marino sobrio
- badge_text: algo que genere curiosidad o urgencia real
- features: 5 features con títulos que suenen a producto real de Stripe/Linear/Notion, no a PowerPoint
- stats: números creíbles y específicos del nicho
- testimonials: personas reales del sector con cargos exactos, frases con detalles concretos
- pricing: nombres de planes creativos (no "Básico/Pro/Enterprise"), precios coherentes con el mercado
- template: "pro" para herramientas B2B/SaaS complejas, "bold" para consumer/fitness/gaming, "minimal" para diseño/creativos, "dark" para dev tools/AI/crypto

Devuelve ÚNICAMENTE JSON válido sin markdown. Estructura exacta:
{
  "template": "dark|minimal|bold|pro",
  "name": "nombre producto",
  "emoji": "emoji relevante al nicho",
  "badge_text": "frase corta urgente o curiosa",
  "hero_headline_1": "máx 5 palabras, alto impacto",
  "hero_headline_2": "promesa específica con giro",
  "hero_description": "1-2 frases que describan el dolor exacto que resuelve",
  "cta_primary": "acción clara y directa",
  "cta_secondary": "alternativa sin compromiso",
  "color_primary": "#hexcolor acorde al nicho",
  "color_accent": "#hexcolor complementario",
  "features_subtitle": "subtítulo que enumera el beneficio principal",
  "features": [{"icon":"emoji","title":"título concreto","desc":"beneficio tangible en 1-2 frases sin vaguedades"}],
  "stats": [{"num":"X","label":"métrica específica del nicho"}],
  "kanban_cols": [{"title":"columna","color":"#hex","cards":["tarea concreta del producto"]}],
  "pricing": [{"name":"nombre creativo del plan","price":"€X","period":"/mes","features":["feature real"],"cta":"texto del botón","popular":false}],
  "cta_section_title": "headline final que cierra la venta",
  "cta_section_sub": "elimina la última objeción del usuario",
  "footer_desc": "tagline de 5-8 palabras que define el producto",
  "logos": ["Empresa real del sector que usaría esto"],
  "testimonials": [{"text":"frase con detalle concreto y resultado medible","name":"Nombre Apellido","role":"Cargo exacto · Empresa tipo","initial":"NA"}]
}`;

/**
 * Rellena el template HTML con el contenido generado por el modelo.
 */
function renderTemplate(content) {
  const templateKey = TEMPLATES[content.template] ? content.template : 'dark';
  let html = fs.readFileSync(TEMPLATES[templateKey], 'utf8');

  // Colores derivados
  const primary = content.color_primary || '#7c3aed';
  const accent = content.color_accent || '#06b6d4';
  const glow = `0 0 40px ${primary}40`;
  const border = `${primary}25`;

  const slug = (content.name || 'product').toLowerCase().replace(/\s+/g, '');

  html = html
    .replace(/\{\{COLOR_PRIMARY\}\}/g, primary)
    .replace(/\{\{COLOR_ACCENT\}\}/g, accent)
    .replace(/\{\{COLOR_GLOW\}\}/g, glow)
    .replace(/\{\{COLOR_BORDER\}\}/g, border)
    .replace(/\{\{PRODUCT_SLUG\}\}/g, slug)
    .replace(/\{\{PRODUCT_NAME\}\}/g, esc(content.name))
    .replace(/\{\{EMOJI\}\}/g, content.emoji || '🚀')
    .replace(/\{\{BADGE_TEXT\}\}/g, esc(content.badge_text))
    .replace(/\{\{HERO_HEADLINE_1\}\}/g, esc(content.hero_headline_1))
    .replace(/\{\{HERO_HEADLINE_2\}\}/g, esc(content.hero_headline_2))
    .replace(/\{\{HERO_DESCRIPTION\}\}/g, esc(content.hero_description))
    .replace(/\{\{CTA_PRIMARY\}\}/g, esc(content.cta_primary))
    .replace(/\{\{CTA_SECONDARY\}\}/g, esc(content.cta_secondary))
    .replace(/\{\{FEATURES_SUBTITLE\}\}/g, esc(content.features_subtitle))
    .replace(/\{\{CTA_SECTION_TITLE\}\}/g, esc(content.cta_section_title))
    .replace(/\{\{CTA_SECTION_SUB\}\}/g, esc(content.cta_section_sub))
    .replace(/\{\{FOOTER_DESC\}\}/g, esc(content.footer_desc))
    .replace(/\{\{YEAR\}\}/g, new Date().getFullYear());

  // Stats — extraer valor numérico para animación de contadores
  const statsHtml = (content.stats || []).map(s => {
    const numMatch = String(s.num).match(/[\d.]+/);
    const dataCount = numMatch ? ` data-count="${numMatch[0]}"` : '';
    return `<div class="stat-card"><div class="stat-num"${dataCount}>${esc(s.num)}</div><div class="stat-label">${esc(s.label)}</div></div>`;
  }).join('');
  html = html.replace(/\{\{STATS_ITEMS\}\}/g, statsHtml);

  // Feature cards
  const featuresHtml = (content.features || []).map(f =>
    `<div class="feature-card fade-up"><span class="feature-icon">${f.icon}</span><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></div>`
  ).join('');
  html = html.replace(/\{\{FEATURE_CARDS\}\}/g, featuresHtml);

  // Kanban cols
  const kanbanHtml = (content.kanban_cols || []).map(col => {
    const cards = (col.cards || []).map(c =>
      `<div class="k-card"><span class="tag" style="background:${col.color}22;color:${col.color}">${col.title}</span><br/>${esc(c)}</div>`
    ).join('');
    return `<div class="k-col"><h4>${esc(col.title)}</h4>${cards}</div>`;
  }).join('');
  html = html.replace(/\{\{KANBAN_COLS\}\}/g, kanbanHtml);

  // Feature preview cards (landing-minimal hero-right)
  const featurePreviewHtml = (content.features || []).slice(0, 3).map(f =>
    `<div class="feature-preview"><span class="fp-icon">${f.icon}</span><div class="fp-body"><h4>${esc(f.title)}</h4><p>${esc(f.desc)}</p><span class="fp-tag">${esc(f.title.split(' ')[0])}</span></div></div>`
  ).join('');
  html = html.replace(/\{\{FEATURE_PREVIEW_CARDS\}\}/g, featurePreviewHtml);

  // Stats side (landing-bold hero)
  const statsSideHtml = (content.stats || []).slice(0, 3).map(s =>
    `<div class="hs-item"><div class="hs-num">${esc(s.num)}</div><div class="hs-label">${esc(s.label)}</div></div>`
  ).join('');
  html = html.replace(/\{\{STATS_SIDE\}\}/g, statsSideHtml);

  // Ticker items (landing-bold)
  const tickerHtml = (content.features || []).map(f =>
    `<span class="ticker-item">${f.icon} ${esc(f.title)} <span class="ticker-sep">·</span></span>`
  ).join('');
  html = html.replace(/\{\{TICKER_ITEMS\}\}/g, tickerHtml);

  // Mockup rows
  const mockupHtml = (content.features || []).slice(0, 4).map((f, i) => {
    const widths = [85, 60, 75, 50];
    return `<div class="mockup-row">
      <span class="mockup-label">${f.icon} ${esc(f.title.split(' ').slice(0, 2).join(' '))}</span>
      <div class="mockup-bar-fill" style="width:${widths[i] || 65}%;opacity:${1 - i * 0.15}"></div>
      <span class="mockup-pill">Activo</span>
    </div>`;
  }).join('');
  html = html.replace(/\{\{MOCKUP_ROWS\}\}/g, mockupHtml);

  // ── PRO TEMPLATE PLACEHOLDERS ──

  // Sidebar items (from features)
  const sidebarHtml = (content.features || []).slice(0, 5).map((f, i) =>
    `<div class="s-nav-item${i === 0 ? ' active' : ''}"><span>${f.icon}</span> ${esc(f.title.split(' ')[0])}</div>`
  ).join('');
  html = html.replace(/\{\{SIDEBAR_ITEMS\}\}/g, sidebarHtml);

  // Screen stat cards (from stats)
  const screenCardsHtml = (content.stats || []).slice(0, 3).map(s => {
    const numMatch = String(s.num).match(/[\d.]+/);
    const dataCount = numMatch ? ` data-count="${numMatch[0]}"` : '';
    return `<div class="s-card"><div class="s-card-num"${dataCount}>${esc(s.num)}</div><div class="s-card-label">${esc(s.label)}</div></div>`;
  }).join('');
  html = html.replace(/\{\{SCREEN_CARDS\}\}/g, screenCardsHtml);

  // Decorative chart bars
  const chartBarHeights = [45, 70, 55, 85, 65, 90, 75, 60, 80, 70, 55, 95];
  const chartBarsHtml = chartBarHeights.map(h =>
    `<div class="s-bar" style="height:${h}%"></div>`
  ).join('');
  html = html.replace(/\{\{CHART_BARS\}\}/g, chartBarsHtml);

  // Logo items
  const defaultLogos = ['Stripe', 'Vercel', 'Linear', 'Notion', 'Figma', 'Slack'];
  const logoItems = content.logos || defaultLogos;
  const logosHtml = logoItems.map(name =>
    `<div class="logo-item">${esc(String(name))}</div>`
  ).join('');
  html = html.replace(/\{\{LOGO_ITEMS\}\}/g, logosHtml);

  // Feature rows — alternating, 3 rows using first 3 features
  const visualTypes = ['kanban', 'search', 'statsvis'];
  const featureRowsHtml = (content.features || []).slice(0, 3).map((f, i) => {
    const isReverse = i % 2 === 1;
    const visualType = visualTypes[i];
    let visualInner = '';
    if (visualType === 'kanban') {
      const cols = content.kanban_cols || [
        { title: 'Por hacer', color: '#ef4444', cards: ['Definir requisitos', 'Investigar mercado'] },
        { title: 'En progreso', color: '#f59e0b', cards: ['Diseño UI'] },
        { title: 'Completado', color: '#22c55e', cards: ['Onboarding', 'Documentación'] }
      ];
      const colsHtml = cols.map(col => {
        const cards = (col.cards || []).map(c =>
          `<div class="fv-card"><span class="fv-badge" style="background:${col.color}15;color:${col.color}">${esc(col.title)}</span><br/>${esc(c)}</div>`
        ).join('');
        return `<div class="fv-col"><div class="fv-col-title">${esc(col.title)}</div>${cards}</div>`;
      }).join('');
      visualInner = `<div class="fv-kanban">${colsHtml}</div>`;
    } else if (visualType === 'search') {
      const results = (content.features || []).slice(0, 3).map(feat =>
        `<div class="fv-result"><div class="fv-result-title">${esc(feat.title)}</div><div class="fv-result-snippet">${esc((feat.desc || '').slice(0, 80))}</div><span class="fv-result-tag">${esc(feat.title.split(' ')[0])}</span></div>`
      ).join('');
      visualInner = `<div class="fv-search"><span class="fv-search-icon">🔍</span>${esc(f.title)}...</div><div class="fv-results">${results}</div>`;
    } else {
      const statItems = (content.stats || []).slice(0, 4).map(s =>
        `<div class="fv-stat"><div class="fv-stat-num">${esc(s.num)}</div><div class="fv-stat-label">${esc(s.label)}</div></div>`
      ).join('');
      visualInner = `<div class="fv-stats">${statItems}</div>`;
    }
    const featList = (content.features || []).slice(i * 2, i * 2 + 3).map(feat =>
      `<li>${esc(feat.title)}</li>`
    ).join('');
    return `<div class="feature-row fade-up${isReverse ? ' reverse' : ''}">
      <div class="feature-text">
        <span class="feature-tag">${f.icon} ${esc(f.title.split(' ')[0])}</span>
        <h3 class="feature-title">${esc(f.title)}</h3>
        <p class="feature-desc">${esc(f.desc)}</p>
        <ul class="feature-list">${featList}</ul>
      </div>
      <div class="feature-visual">
        <div class="fv-header"><div class="fv-dots"><div class="fv-dot" style="background:#ff5f56"></div><div class="fv-dot" style="background:#ffbd2e"></div><div class="fv-dot" style="background:#27c93f"></div></div><div class="fv-title">${esc(f.title)}</div></div>
        <div class="fv-body">${visualInner}</div>
      </div>
    </div>`;
  }).join('');
  html = html.replace(/\{\{FEATURE_ROWS\}\}/g, featureRowsHtml);

  // Testimonial cards
  const defaultTestimonials = [
    { text: 'Ha transformado completamente la forma en que nuestro equipo gestiona el conocimiento.', name: 'Ana García', role: 'CTO · Startup Tech', initial: 'AG' },
    { text: 'La búsqueda semántica es increíblemente precisa. Encontramos ideas que habíamos olvidado hace meses.', name: 'Carlos Ruiz', role: 'Product Manager · Scale-up', initial: 'CR' },
    { text: 'Implementación en un día, resultados desde el primer uso. El ROI fue inmediato.', name: 'María López', role: 'CEO · Agencia Digital', initial: 'ML' }
  ];
  const testimonials = (content.testimonials && content.testimonials.length) ? content.testimonials : defaultTestimonials;
  const testimonialsHtml = testimonials.map(t =>
    `<div class="testimonial-card fade-up">
      <div class="t-stars">★★★★★</div>
      <p class="t-text">"${esc(t.text)}"</p>
      <div class="t-author">
        <div class="t-avatar">${esc(t.initial || String(t.name).slice(0, 2).toUpperCase())}</div>
        <div><div class="t-name">${esc(t.name)}</div><div class="t-role">${esc(t.role)}</div></div>
      </div>
    </div>`
  ).join('');
  html = html.replace(/\{\{TESTIMONIAL_CARDS\}\}/g, testimonialsHtml);

  // Pricing cards — el plan popular es siempre el del medio (índice 1)
  const plans = content.pricing || [];
  const popularIdx = plans.length === 3 ? 1 : plans.findIndex(p => p.popular) !== -1 ? plans.findIndex(p => p.popular) : Math.floor(plans.length / 2);
  const pricingHtml = plans.map((plan, idx) => {
    const isPopular = idx === popularIdx;
    const featList = (plan.features || []).map(f => `<li>${esc(f)}</li>`).join('');
    return `<div class="plan-card${isPopular ? ' popular' : ''}">
      ${isPopular ? '<div class="plan-popular-badge">⭐ Más popular</div>' : ''}
      <div class="plan-name">${esc(plan.name)}</div>
      <div class="plan-price">${esc(plan.price)}<sub>${esc(plan.period)}</sub></div>
      <ul class="plan-features">${featList}</ul>
      <button class="plan-btn ${isPopular ? 'plan-btn-primary' : 'plan-btn-outline'}">${esc(plan.cta)}</button>
    </div>`;
  }).join('');
  html = html.replace(/\{\{PRICING_CARDS\}\}/g, pricingHtml);

  return html;
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseContent(text) {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // JSON directo
  try { return JSON.parse(clean); } catch { }
  // Extraer de markdown fence
  const fence = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { } }
  // Regex genérica
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { } }
  return null;
}

function buildPrompt(task, spec, hasImage = false) {
  const lines = [];
  if (typeof spec === 'object' && spec) {
    lines.push(`PRODUCTO: ${spec.name || task}`);
    if (spec.summary || spec.vision) lines.push(`CONTEXTO: ${spec.summary || spec.vision}`);
    if (spec.target_audience) lines.push(`AUDIENCIA: ${spec.target_audience}`);
    if (spec.features?.length) {
      const feats = spec.features.slice(0, 6).map(f => {
        const n = typeof f === 'string' ? f : (f.name || f.title);
        const d = typeof f === 'object' ? (f.description || f.desc || '') : '';
        return `  - ${n}${d ? `: ${d}` : ''}`;
      }).join('\n');
      lines.push(`FUNCIONALIDADES:\n${feats}`);
    }
    if (spec.differentiator || spec.unique_value) lines.push(`DIFERENCIADOR: ${spec.differentiator || spec.unique_value}`);
    if (task) lines.push(`\nINSTRUCCIONES ESPECÍFICAS:\n${task}`);
  } else {
    lines.push(`PRODUCTO: ${task}`);
  }

  lines.push(`
IMPORTANTE: Sé ESPECÍFICO al nicho de este producto. Nada genérico. El copy debe sonar a que fue escrito por alguien que conoce el sector a fondo. Elige template y colores coherentes con el tipo de producto.`);

  if (hasImage) {
    lines.push(`IMAGEN DE REFERENCIA adjunta: usa su estilo visual, disposición y contenido para guiar el diseño.`);
  }

  lines.push(`\nGenera el JSON de contenido para la landing page.`);
  return lines.join('\n');
}

async function writeFilesToDisk(projectId, projectName, files) {
  if (!files?.length) return null;
  const safeName = (projectName || `project-${projectId}`)
    .toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 50);
  const workspaceRoot = path.resolve(process.cwd(), 'workspace', safeName);
  for (const file of files) {
    if (!file.path || !file.code) continue;
    const safePath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(workspaceRoot, safePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.code, 'utf8');
  }
  console.log(`[Developer] Archivos escritos en: ${workspaceRoot}`);
  return workspaceRoot;
}

function buildFallbackContent(task, spec) {
  const name = (typeof spec === 'object' && spec?.name) ? spec.name : (task || 'Mi Producto');
  return {
    template: 'dark', name, emoji: '🚀', badge_text: 'Nuevo',
    hero_headline_1: `Bienvenido a ${name}`, hero_headline_2: 'La solución que necesitabas',
    hero_description: spec?.summary || spec?.vision || `${name} te ayuda a alcanzar tus objetivos.`,
    cta_primary: 'Empezar gratis', cta_secondary: 'Ver demo',
    color_primary: '#7c3aed', color_accent: '#a78bfa',
    features_subtitle: 'Todo lo que necesitas en un solo lugar',
    features: [
      { icon: '⚡', title: 'Rápido', desc: 'Rendimiento optimizado para máxima velocidad.' },
      { icon: '🔒', title: 'Seguro', desc: 'Tus datos protegidos con cifrado de nivel enterprise.' },
      { icon: '📊', title: 'Analytics', desc: 'Métricas en tiempo real para mejores decisiones.' },
      { icon: '🤖', title: 'IA integrada', desc: 'Automatización inteligente que aprende de ti.' },
      { icon: '🌐', title: 'Global', desc: 'Disponible en cualquier lugar del mundo.' }
    ],
    stats: [{ num: '10K+', label: 'usuarios activos' }, { num: '99.9%', label: 'uptime' }, { num: '2x', label: 'más productivo' }],
    kanban_cols: [
      { title: 'Por hacer', color: '#ef4444', cards: ['Configurar cuenta', 'Importar datos'] },
      { title: 'En progreso', color: '#f59e0b', cards: ['Integrar API'] },
      { title: 'Hecho', color: '#10b981', cards: ['Onboarding completado'] }
    ],
    pricing: [
      { name: 'Gratis', price: '€0', period: '/mes', features: ['5 proyectos', 'Soporte básico'], cta: 'Empezar', popular: false },
      { name: 'Pro', price: '€19', period: '/mes', features: ['Proyectos ilimitados', 'Soporte prioritario', 'IA avanzada'], cta: 'Elegir Pro', popular: true }
    ],
    cta_section_title: `Empieza con ${name} hoy`, cta_section_sub: 'Sin tarjeta de crédito. Cancela cuando quieras.',
    footer_desc: `${name} — La mejor solución para tu negocio`,
    logos: ['Google', 'Microsoft', 'Stripe', 'Notion'],
    testimonials: [{ text: 'Increíble producto. Lo recomiendo totalmente a cualquier equipo.', name: 'María García', role: 'CEO · TechCorp', initial: 'MG' }]
  };
}

export async function developer({ spec, task, projectId = null, projectName = '', image = null }) {
  try {
    const prompt = buildPrompt(task, spec, !!image);
    const { text, provider, model } = await smartChat('developer', CONTENT_SYSTEM, prompt, 3000, image);

    let content = parseContent(text);
    if (!content) {
      console.warn('[Developer] Modelo no devolvió JSON válido, usando fallback de plantilla');
      content = buildFallbackContent(task, spec);
    }

    const templateKey = TEMPLATES[content.template] ? content.template : 'dark';
    const htmlCode = renderTemplate(content);
    const files = [{ path: 'index.html', language: 'html', description: 'Landing page del producto', code: htmlCode }];

    const data = {
      files,
      run_commands: [],
      dependencies: [],
      env_vars: [],
      notes: `Template '${templateKey}' renderizado con contenido de ${provider}/${model}`
    };

    const workspacePath = await writeFilesToDisk(projectId, projectName, files);
    if (workspacePath) data.workspace_path = workspacePath;

    await saveDevSession({ project_id: projectId, task, files: JSON.stringify(files), notes: data.notes });
    console.log(`[Developer] Landing generada vía ${provider} — template: '${templateKey}' — ${htmlCode.length} chars`);
    return { success: true, data };

  } catch (err) {
    console.error('[Developer Agent ERROR]:', err);
    return { success: false, error: err.message };
  }
}
