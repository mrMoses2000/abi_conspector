import fs from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

function sanitizeMermaidNodeQuotes(source) {
  return String(source || '').replace(/\[[^\]\n]*\]|\{[^\}\n]*\}/g, (token) => token.replace(/"/g, "'"));
}

function sanitizeMermaidFences(markdown) {
  return String(markdown || '').replace(/```mermaid\s*([\s\S]*?)```/gi, (_match, code) => {
    const cleaned = sanitizeMermaidNodeQuotes(code).trimEnd();
    return `\`\`\`mermaid\n${cleaned}\n\`\`\``;
  });
}

/**
 * Transform GitHub-style alerts: > [!NOTE], > [!IMPORTANT], > [!WARNING], > [!TIP], > [!CAUTION]
 * in the rendered HTML into styled callout divs.
 */
function transformCallouts(html) {
  const alertTypes = {
    NOTE: { icon: '💡', label: 'Заметка', cls: 'callout-note' },
    TIP: { icon: '✅', label: 'Совет', cls: 'callout-tip' },
    IMPORTANT: { icon: '⚡', label: 'Важно', cls: 'callout-important' },
    WARNING: { icon: '⚠️', label: 'Внимание', cls: 'callout-warning' },
    CAUTION: { icon: '🔴', label: 'Осторожно', cls: 'callout-caution' }
  };

  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*<br\s*\/?>\s*/gi,
    (_, type) => {
      const upper = type.toUpperCase();
      const info = alertTypes[upper] || alertTypes.NOTE;
      return `<div class="callout ${info.cls}"><div class="callout-title">${info.icon} ${info.label}</div><div class="callout-body"><p>`;
    }
  ).replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/gi,
    (_, type) => {
      const upper = type.toUpperCase();
      const info = alertTypes[upper] || alertTypes.NOTE;
      return `<div class="callout ${info.cls}"><div class="callout-title">${info.icon} ${info.label}</div><div class="callout-body"><p>`;
    }
  );
}

/**
 * Generate floating table of contents from h2/h3 headings.
 */
function generateToc(html) {
  const headings = [];
  const withIds = html.replace(/<(h[23])>(.*?)<\/\1>/gi, (match, tag, text) => {
    const id = `toc-${headings.length}`;
    const level = tag === 'h2' ? 2 : 3;
    headings.push({ id, text: text.replace(/<[^>]+>/g, ''), level });
    return `<${tag} id="${id}">${text}</${tag}>`;
  });

  if (headings.length < 3) return { html: withIds, toc: '' };

  const tocItems = headings.map(h => {
    const indent = h.level === 3 ? ' class="toc-sub"' : '';
    return `<li${indent}><a href="#${h.id}">${h.text}</a></li>`;
  }).join('\n      ');

  const toc = `
    <nav class="toc" id="toc">
      <div class="toc-title">Оглавление</div>
      <ul>${tocItems}</ul>
    </nav>`;

  return { html: withIds, toc };
}

/**
 * @param {{
 *   mergedPath: string;
 *   htmlPath: string;
 *   title: string;
 * }} payload
 */
export async function renderHtmlFromMarkdown(payload) {
  let mergedMd = await fs.readFile(payload.mergedPath, 'utf8');
  mergedMd = sanitizeMermaidFences(mergedMd);
  let rendered = md.render(mergedMd);

  rendered = transformCallouts(rendered);
  const { html: withIds, toc } = generateToc(rendered);
  rendered = withIds;

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#0f172a" />
  <title>${escapeHtml(payload.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0f172a;
      --bg-subtle: #1e293b;
      --panel: rgba(30, 41, 59, 0.88);
      --panel-border: rgba(99, 102, 241, 0.1);
      --text: #e2e8f0;
      --text-secondary: #94a3b8;
      --accent: #6366f1;
      --accent-light: #818cf8;
      --accent-bg: rgba(99, 102, 241, 0.08);
      --green: #34d399;
      --amber: #fbbf24;
      --red: #f87171;
      --radius: 14px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.72;
      background: var(--bg);
      background-image:
        radial-gradient(ellipse 80% 50% at 15% -10%, rgba(99,102,241,0.1) 0%, transparent 60%),
        radial-gradient(ellipse 50% 40% at 85% 5%, rgba(59,130,246,0.08) 0%, transparent 55%);
      -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; position: relative; }

    /* ─── Hero ─── */
    .hero { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--panel-border); }
    .hero-title {
      font-family: 'Merriweather', Georgia, serif;
      font-size: 32px; font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #c7d2fe, #6366f1);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-sub { margin-top: 6px; color: var(--text-secondary); font-size: 14px; }

    /* ─── TOC ─── */
    .toc {
      position: sticky; top: 24px; float: right; width: 220px; margin-left: 32px; margin-bottom: 16px;
      background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius);
      padding: 16px; backdrop-filter: blur(12px); font-size: 13px; max-height: calc(100vh - 48px); overflow-y: auto;
    }
    .toc-title { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-light); margin-bottom: 10px; }
    .toc ul { list-style: none; }
    .toc li { margin-bottom: 6px; }
    .toc li.toc-sub { padding-left: 14px; }
    .toc a { color: var(--text-secondary); text-decoration: none; transition: color 0.15s; }
    .toc a:hover { color: var(--accent-light); }

    /* ─── Article ─── */
    article {
      background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius);
      padding: 32px; backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
    }

    /* ─── Headings ─── */
    article h1, article h2, article h3 {
      font-family: 'Merriweather', Georgia, serif;
      letter-spacing: -0.01em; color: #f1f5f9;
    }
    article h2 {
      margin-top: 36px; padding-top: 20px; padding-left: 14px;
      border-left: 3px solid var(--accent); border-top: none; font-size: 22px;
    }
    article h3 { margin-top: 24px; font-size: 18px; color: var(--accent-light); }

    /* ─── Text ─── */
    article p, article li { line-height: 1.72; margin-bottom: 8px; }
    article ul, article ol { padding-left: 24px; margin-bottom: 12px; }
    article li::marker { color: var(--accent-light); }
    article strong { color: #f1f5f9; }
    article em { color: var(--text-secondary); }
    article mark, article .highlight { background: rgba(251,191,36,0.15); color: var(--amber); padding: 1px 5px; border-radius: 4px; }
    article a { color: var(--accent-light); text-decoration: underline; text-underline-offset: 3px; }
    article a:hover { color: #c7d2fe; }

    /* ─── Blockquotes ─── */
    article blockquote {
      margin: 16px 0; padding: 14px 18px;
      border-left: 3px solid var(--accent);
      background: var(--accent-bg); border-radius: 0 var(--radius) var(--radius) 0;
      color: #cbd5e1; font-style: italic;
    }
    article blockquote p { margin-bottom: 4px; }

    /* ─── Callout blocks ─── */
    .callout {
      margin: 16px 0; padding: 14px 18px; border-radius: var(--radius);
      border-left: 3px solid; background: var(--accent-bg);
    }
    .callout-title { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
    .callout-body { font-size: 15px; }
    .callout-body p { margin-bottom: 4px; }
    .callout-note { border-color: #60a5fa; background: rgba(96,165,250,0.06); }
    .callout-note .callout-title { color: #93bbfc; }
    .callout-tip { border-color: var(--green); background: rgba(52,211,153,0.06); }
    .callout-tip .callout-title { color: var(--green); }
    .callout-important { border-color: var(--accent); background: var(--accent-bg); }
    .callout-important .callout-title { color: var(--accent-light); }
    .callout-warning { border-color: var(--amber); background: rgba(251,191,36,0.06); }
    .callout-warning .callout-title { color: var(--amber); }
    .callout-caution { border-color: var(--red); background: rgba(248,113,113,0.06); }
    .callout-caution .callout-title { color: var(--red); }

    /* ─── Code ─── */
    article code { background: rgba(99,102,241,0.1); color: #c7d2fe; padding: 2px 7px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.88em; }
    article pre {
      background: #020617; color: #e2e8f0; padding: 18px; border-radius: var(--radius);
      overflow: auto; margin: 14px 0; border: 1px solid rgba(99,102,241,0.1);
    }
    article pre code { background: transparent; padding: 0; color: inherit; font-size: 14px; }

    /* ─── Tables ─── */
    article table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
    article th, article td { border: 1px solid rgba(99,102,241,0.12); padding: 10px 12px; text-align: left; }
    article th { background: rgba(99,102,241,0.06); color: var(--accent-light); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
    article tr:nth-child(even) { background: rgba(15,23,42,0.4); }

    /* ─── Mermaid ─── */
    .mermaid, pre.mermaid {
      background: rgba(15,23,42,0.6); border: 1px solid var(--panel-border);
      border-radius: var(--radius); padding: 16px; margin: 16px 0;
      text-align: center;
    }

    /* ─── Horizontal rule ─── */
    article hr {
      border: none; height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      margin: 32px 0; opacity: 0.4;
    }

    /* ─── Print ─── */
    @media print {
      body { background: #fff; color: #1e293b; }
      .toc { display: none; }
      article { box-shadow: none; border: none; background: #fff; backdrop-filter: none; padding: 0; }
      .hero-title { -webkit-text-fill-color: #1e293b; background: none; }
      article h2 { border-left-color: #1e293b; }
      .callout { border-color: #64748b; background: #f8fafc; }
      article pre { background: #f1f5f9; color: #1e293b; }
      article code { background: #e2e8f0; color: #334155; }
      article blockquote { background: #f8fafc; color: #475569; }
    }

    /* ─── Responsive ─── */
    @media (max-width: 940px) {
      .toc { display: none; }
      .hero-title { font-size: 26px; }
      article { padding: 20px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <h1 class="hero-title">${escapeHtml(payload.title)}</h1>
      <p class="hero-sub">Сгенерировано ABI Conspector</p>
    </header>
    ${toc}
    <article>${rendered}</article>
  </main>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0f172a',
        primaryColor: '#6366f1',
        primaryTextColor: '#e2e8f0',
        lineColor: '#475569'
      },
      securityLevel: 'loose'
    });
  </script>
</body>
</html>`;

  await fs.writeFile(payload.htmlPath, html, 'utf8');
}

/**
 * @param {{ mergedPath: string; htmlPath: string; title: string; reason?: string; }} payload
 */
export async function renderEmergencyHtml(payload) {
  const mergedMd = await fs.readFile(payload.mergedPath, 'utf8').catch(() => '# Empty merge output');
  const safeTitle = escapeHtml(payload.title);
  const safeReason = escapeHtml(payload.reason || 'unknown');
  const safeBody = escapeHtml(mergedMd);

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: 'Inter', -apple-system, sans-serif; }
    main { max-width: 860px; margin: 32px auto; padding: 0 20px; }
    section { background: rgba(30,41,59,0.88); border: 1px solid rgba(248,113,113,0.15); border-radius: 14px; padding: 20px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #f87171; }
    p { color: #94a3b8; margin: 8px 0; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border-radius: 10px; padding: 16px; font-size: 14px; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>${safeTitle}</h1>
      <p>Rendered in emergency mode.</p>
      <p>Reason: ${safeReason}</p>
    </section>
    <section>
      <pre>${safeBody}</pre>
    </section>
  </main>
</body>
</html>`;

  await fs.writeFile(payload.htmlPath, html, 'utf8');
}

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
