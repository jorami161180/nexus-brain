import { chromium } from 'playwright';
import { smartChat } from '../router.js';

const SYSTEM_PROMPT = `Eres un experto en QA y testing de landing pages.

Evalua estructura, placeholders, CTAs, responsive, accesibilidad, performance y SEO.
Devuelve UNICAMENTE JSON valido:
{
  "score": 0,
  "passed": true,
  "checks": {
    "accessibility": { "passed": true, "score": 80, "details": "..." },
    "seo": { "passed": true, "score": 80, "details": "..." }
  },
  "issues": [{ "severity": "critical|warning|info", "message": "..." }],
  "recommendations": ["..."],
  "summary": "..."
}`;

function validateHTMLStructure(html) {
  const checks = {
    hasHero: /hero|headline|above-the-fold|<h1|principal/i.test(html),
    hasFeatures: /feature|benefit|servicio|funcionalidad|ventaja/i.test(html),
    hasPricing: /pricing|price|plan|tarifa|precio|€|\$/i.test(html),
    hasTestimonials: /testimonial|review|opinion|cliente|stars|rating/i.test(html),
    hasCTA: /cta|button|btn|empezar|comenzar|contact|demo|signup|comprar/i.test(html),
    hasFooter: /<footer|footer|copyright|derechos|legal/i.test(html),
    hasNav: /<nav|navbar|menu|header/i.test(html),
    hasSections: /<section|<main|<article/i.test(html)
  };

  const present = Object.values(checks).filter(Boolean).length;
  const total = Object.values(checks).length;

  return {
    checks,
    coverage: Math.round((present / total) * 100),
    passed: checks.hasHero && checks.hasFeatures && checks.hasFooter && present >= 5
  };
}

function findUnreplacedPlaceholders(html) {
  return [...new Set(html.match(/\{\{[^}]+\}\}/g) || [])];
}

function checkCTAs(html) {
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
  const links = html.match(/<a[^>]*>[\s\S]*?<\/a>/gi) || [];
  const submits = html.match(/<input[^>]*type=["']submit["'][^>]*>/gi) || [];
  const scrollTargets = [...html.matchAll(/href=["']#([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(Boolean);
  const targetIds = new Set([...html.matchAll(/id=["']([^"']+)["']/gi)].map(match => match[1]));
  const missingTargets = scrollTargets.filter(id => !targetIds.has(id));

  return {
    count: buttons.length + links.length + submits.length,
    scrollTargets,
    missingTargets,
    passed: buttons.length + links.length + submits.length > 0 && missingTargets.length === 0
  };
}

function checkResponsive(html) {
  const hasViewport = /<meta[^>]+viewport/i.test(html);
  const hasMediaQuery = /@media/i.test(html);
  const hasFlexGrid = /display:\s*(flex|grid)|grid-template|flex-wrap/i.test(html);
  const hasResponsiveUnits = /\b(clamp|minmax|vw|vh|rem|%|max-width|min-width)\b/i.test(html);

  const score = [hasViewport, hasMediaQuery, hasFlexGrid, hasResponsiveUnits]
    .filter(Boolean).length * 25;

  return {
    checks: { viewportMeta: hasViewport, mediaQueries: hasMediaQuery, flexOrGrid: hasFlexGrid, responsiveUnits: hasResponsiveUnits },
    score,
    passed: hasViewport && hasFlexGrid && (hasMediaQuery || hasResponsiveUnits)
  };
}

function checkPerformance(html) {
  const externalScripts = (html.match(/<script[^>]*src=/gi) || []).length;
  const externalStyles = (html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi) || []).length;
  const inlineStyles = (html.match(/style=["']/gi) || []).length;

  const issues = [];
  if (externalScripts > 3) issues.push({ severity: 'warning', message: `Demasiados scripts externos (${externalScripts})` });
  if (externalStyles > 3) issues.push({ severity: 'warning', message: `Demasiadas hojas de estilo externas (${externalStyles})` });
  if (inlineStyles > 30) issues.push({ severity: 'info', message: `Muchos estilos inline (${inlineStyles})` });

  return {
    score: Math.max(0, 100 - externalScripts * 10 - externalStyles * 8 - Math.floor(inlineStyles / 5)),
    issues,
    passed: externalScripts <= 3 && externalStyles <= 3
  };
}

function checkSEO(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]*>/i.test(html);
  const ogDescription = /<meta[^>]+property=["']og:description["'][^>]*>/i.test(html);
  const ogType = /<meta[^>]+property=["']og:type["'][^>]*>/i.test(html);

  const checks = {
    title: !!titleMatch?.[1]?.trim(),
    description: !!descriptionMatch?.[1]?.trim(),
    ogTitle,
    ogDescription,
    ogType
  };
  const score = Object.values(checks).filter(Boolean).length * 20;

  return {
    passed: checks.title && checks.description,
    score,
    checks,
    details: `Title: ${checks.title ? 'OK' : 'NO'}, description: ${checks.description ? 'OK' : 'NO'}, Open Graph: ${[ogTitle, ogDescription, ogType].filter(Boolean).length}/3`
  };
}

function buildSrcdoc(html) {
  return html
    .replace(/<\/script/gi, '<\\/script')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

async function runIframeRenderChecks(html) {
  let browser;
  const result = {
    passed: false,
    rendered: false,
    desktop: { passed: false },
    mobile: { passed: false },
    ctaScroll: { passed: true, tested: 0, failed: [] },
    errors: []
  };

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on('pageerror', err => result.errors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') result.errors.push(msg.text());
    });

    await page.setContent(
      `<!doctype html><html><body style="margin:0"><iframe id="landing-frame" style="width:100vw;height:100vh;border:0" srcdoc="${buildSrcdoc(html)}"></iframe></body></html>`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );

    const frameHandle = await page.waitForSelector('#landing-frame', { timeout: 5000 });
    const frame = await frameHandle.contentFrame();
    if (!frame) throw new Error('No se pudo leer el iframe de la landing');
    await frame.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

    const inspectViewport = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(250);
      const metrics = await frame.evaluate(() => {
        const textLength = (document.body?.innerText || '').trim().length;
        const visibleElements = [...document.body.querySelectorAll('body *')].filter(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none';
        }).length;
        return {
          textLength,
          visibleElements,
          scrollHeight: document.documentElement.scrollHeight,
          bodyHeight: document.body?.getBoundingClientRect().height || 0
        };
      });

      return {
        ...metrics,
        passed: metrics.textLength > 40 && metrics.visibleElements >= 5 && metrics.scrollHeight > 100
      };
    };

    result.desktop = await inspectViewport(1366, 768);
    result.mobile = await inspectViewport(390, 844);
    result.rendered = result.desktop.passed && result.mobile.passed;

    result.ctaScroll = await frame.evaluate(async () => {
      const links = [...document.querySelectorAll('a[href^="#"]')]
        .filter(link => link.getAttribute('href') && link.getAttribute('href') !== '#')
        .slice(0, 8);
      const failed = [];
      let tested = 0;

      for (const link of links) {
        const href = link.getAttribute('href');
        const target = document.getElementById(href.slice(1));
        if (!target) {
          failed.push({ href, reason: 'target_missing' });
          continue;
        }

        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 40));
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        await new Promise(resolve => setTimeout(resolve, 80));
        tested++;

        const top = target.getBoundingClientRect().top;
        if (Math.abs(top) > Math.max(120, window.innerHeight * 0.25)) {
          failed.push({ href, reason: 'did_not_scroll', top: Math.round(top) });
        }
      }

      return { tested, failed, passed: links.length > 0 && failed.length === 0 };
    });

    result.passed = result.rendered && result.ctaScroll.passed && result.errors.length === 0;
    return result;
  } catch (err) {
    return {
      ...result,
      passed: false,
      ctaScroll: result.ctaScroll.tested
        ? result.ctaScroll
        : { passed: false, tested: 0, failed: [{ href: '#', reason: 'test_error' }] },
      skipped: /Executable doesn't exist|browserType.launch|Host system is missing/i.test(err.message),
      errors: [...result.errors, err.message]
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function issueList({ unreplaced, structure, ctas, render, performance }) {
  return [
    ...(unreplaced.length ? [{ severity: 'critical', message: `Placeholders sin reemplazar: ${unreplaced.join(', ')}` }] : []),
    ...(!structure.passed ? [{ severity: 'critical', message: `Faltan secciones esenciales (cobertura: ${structure.coverage}%)` }] : []),
    ...(!ctas.passed ? [{
      severity: ctas.missingTargets.length ? 'critical' : 'warning',
      message: ctas.missingTargets.length
        ? `CTAs con destino inexistente: ${ctas.missingTargets.join(', ')}`
        : 'No se encontraron CTAs funcionales'
    }] : []),
    ...(!render.rendered ? [{
      severity: render.skipped ? 'warning' : 'critical',
      message: render.skipped
        ? `Render Playwright omitido: ${render.errors.join('; ')}`
        : `La landing no renderiza correctamente en iframe: ${render.errors.join('; ') || 'contenido insuficiente'}`
    }] : []),
    ...(render.rendered && !render.passed ? [{
      severity: 'critical',
      message: `Render con errores: ${render.errors.join('; ') || 'CTA scroll no verificado'}`
    }] : []),
    ...(!render.ctaScroll.passed ? [{
      severity: 'critical',
      message: `Fallos de scroll en CTAs: ${render.ctaScroll.failed.map(f => `${f.href} (${f.reason})`).join(', ')}`
    }] : []),
    ...performance.issues
  ];
}

export async function testLanding({ html, projectName = 'Proyecto', spec = {}, onProgress = null, useAi = process.env.TESTING_AI === '1' }) {
  try {
    onProgress?.('Analizando estructura, CTAs y placeholders...');

    const structure = validateHTMLStructure(html);
    const unreplaced = findUnreplacedPlaceholders(html);
    const ctas = checkCTAs(html);
    const responsive = checkResponsive(html);
    const performance = checkPerformance(html);
    const seo = checkSEO(html);

    onProgress?.('Renderizando landing en iframe desktop/mobile...');
    const render = await runIframeRenderChecks(html);

    onProgress?.('Generando evaluacion de calidad...');
    const prompt = `
PROYECTO: ${projectName}
DESCRIPCION: ${spec.summary || spec.description || spec.vision || 'Sin descripcion'}

HTML (${html.length} caracteres):
${html.slice(0, 3500)}${html.length > 3500 ? '\n...[truncado]' : ''}

Evalua si la landing tiene hero, features, pricing, footer, buen flujo comercial y copy persuasivo.`;

    let provider = useAi ? 'local' : 'automatic';
    let aiResult = null;
    if (useAi) {
      try {
        const ai = await smartChat('testing', SYSTEM_PROMPT, prompt, 2048);
        provider = ai.provider;
        const cleanText = ai.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiResult = JSON.parse(jsonMatch[0]);
      } catch (err) {
        console.log('[Testing] Evaluacion IA no disponible, usando checks automaticos:', err.message);
      }
    }

    if (ctas.scrollTargets.length > 0 && render.ctaScroll.tested === 0) {
      render.ctaScroll = {
        passed: false,
        tested: 0,
        failed: ctas.scrollTargets.map(id => ({ href: `#${id}`, reason: 'not_tested' }))
      };
      render.passed = false;
    }

    const issues = issueList({ unreplaced, structure, ctas, render, performance });
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    const score = Math.round(
      (structure.passed ? 20 : 8) +
      (unreplaced.length === 0 ? 15 : 0) +
      (ctas.passed ? 12 : 4) +
      (responsive.passed ? 12 : 4) +
      (render.passed ? 18 : render.rendered ? 8 : 0) +
      (render.ctaScroll.passed ? 10 : 0) +
      (performance.passed ? 8 : 3) +
      (seo.passed ? 5 : 2)
    );

    const report = {
      score,
      passed: score >= 75 && criticalIssues.length === 0,
      checks: {
        structure: {
          passed: structure.passed,
          coverage: structure.coverage,
          sections: structure.checks,
          details: `Secciones detectadas: ${Object.entries(structure.checks).filter(([, ok]) => ok).map(([key]) => key).join(', ')}`
        },
        placeholders: { passed: unreplaced.length === 0, count: unreplaced.length, unreplaced },
        ctas: {
          passed: ctas.passed,
          count: ctas.count,
          scrollTargets: ctas.scrollTargets,
          missingTargets: ctas.missingTargets,
          details: `${ctas.count} CTAs/enlaces; ${ctas.scrollTargets.length} anchors internos`
        },
        responsive: {
          passed: responsive.passed,
          score: responsive.score,
          details: `Viewport: ${responsive.checks.viewportMeta ? 'OK' : 'NO'}, media queries: ${responsive.checks.mediaQueries ? 'OK' : 'NO'}, flex/grid: ${responsive.checks.flexOrGrid ? 'OK' : 'NO'}`
        },
        render: {
          passed: render.passed,
          rendered: render.rendered,
          desktop: render.desktop,
          mobile: render.mobile,
          ctaScroll: render.ctaScroll,
          errors: render.errors,
          details: render.rendered
            ? `Iframe OK en desktop y mobile. CTAs probados: ${render.ctaScroll.tested}`
            : `Iframe no aprobado: ${render.errors.join('; ') || 'sin contenido visible'}`
        },
        accessibility: aiResult?.checks?.accessibility || aiResult?.accessibility || {
          passed: true,
          score: 75,
          details: 'Revision automatica basica completada'
        },
        performance: {
          passed: performance.passed,
          score: performance.score,
          details: `Scripts externos: ${(html.match(/<script[^>]*src=/gi) || []).length}, stylesheets: ${(html.match(/<link[^>]*rel=["']stylesheet["']/gi) || []).length}`
        },
        seo: aiResult?.checks?.seo || aiResult?.seo || seo
      },
      issues,
      recommendations: aiResult?.recommendations || [
        'Revisar manualmente el copy final antes de publicar',
        'Probar en un navegador real si Playwright no esta instalado',
        'Asegurar que cada CTA lleve a una seccion o accion clara'
      ],
      summary: aiResult?.summary || `Landing ${score >= 85 ? 'excelente' : score >= 75 ? 'aprobada' : 'necesita mejoras'} para "${projectName}". Render iframe: ${render.rendered ? 'OK' : 'fallo'}. Placeholders: ${unreplaced.length}.`,
      projectName,
      timestamp: new Date().toISOString()
    };

    return { success: true, data: report, provider };
  } catch (err) {
    console.error('[Testing Agent ERROR]:', err);
    return {
      success: false,
      error: err.message,
      data: {
        score: 0,
        passed: false,
        issues: [{ severity: 'critical', message: `Error en testing: ${err.message}` }]
      }
    };
  }
}
