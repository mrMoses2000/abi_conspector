import fs from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

function sanitizeMermaidNodeQuotes(source) {
  const normalizeLabel = (rawLabel) => {
    const label = String(rawLabel ?? '').trim();
    const unwrapped = (
      (label.startsWith('"') && label.endsWith('"')) ||
      (label.startsWith("'") && label.endsWith("'"))
    )
      ? label.slice(1, -1)
      : label;
    const normalized = unwrapped
      .replace(/\\"/g, "'")
      .replace(/"/g, "'")
      .replace(/\r?\n/g, ' ')
      .trim();
    return `"${normalized}"`;
  };

  // Force explicit quoted labels for [] and {} node forms to avoid Mermaid parse errors
  // on punctuation, parentheses, Cyrillic text, and mixed quotes.
  return String(source || '')
    .replace(/([A-Za-z0-9_-]+)\[([^\]\n]*)\]/g, (_match, nodeId, rawLabel) => `${nodeId}[${normalizeLabel(rawLabel)}]`)
    .replace(/([A-Za-z0-9_-]+)\{([^\}\n]*)\}/g, (_match, nodeId, rawLabel) => `${nodeId}{${normalizeLabel(rawLabel)}}`);
}

export function sanitizeMermaidFences(markdown) {
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
    /* ─── Dark Theme (default) ─── */
    :root {
      --bg: #0f172a;
      --bg-subtle: #1e293b;
      --panel: rgba(30, 41, 59, 0.88);
      --panel-border: rgba(99, 102, 241, 0.1);
      --text: #e2e8f0;
      --text-secondary: #94a3b8;
      --heading-color: #f1f5f9;
      --accent: #6366f1;
      --accent-light: #818cf8;
      --accent-bg: rgba(99, 102, 241, 0.08);
      --green: #34d399;
      --amber: #fbbf24;
      --red: #f87171;
      --radius: 14px;
      --code-bg: rgba(99,102,241,0.1);
      --code-color: #c7d2fe;
      --pre-bg: #020617;
      --pre-border: rgba(99,102,241,0.1);
      --table-border: rgba(99,102,241,0.12);
      --table-header-bg: rgba(99,102,241,0.08);
      --table-stripe: rgba(15,23,42,0.4);
      --table-hover: rgba(99,102,241,0.06);
      --blockquote-color: #cbd5e1;
      --mermaid-bg: rgba(15,23,42,0.6);
      --shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
      --callout-shadow: 0 2px 12px rgba(0,0,0,0.15);
      --bg-gradient: radial-gradient(ellipse 80% 50% at 15% -10%, rgba(99,102,241,0.12) 0%, transparent 60%),
        radial-gradient(ellipse 50% 40% at 85% 5%, rgba(59,130,246,0.1) 0%, transparent 55%),
        radial-gradient(ellipse 40% 30% at 50% 100%, rgba(99,102,241,0.06) 0%, transparent 50%);
      --hero-gradient: linear-gradient(135deg, #e0e7ff 0%, #818cf8 50%, #6366f1 100%);
      --mark-bg: rgba(251,191,36,0.15);
      --selection-bg: rgba(99,102,241,0.3);
      --selection-color: #f1f5f9;
      --note-bg: rgba(96,165,250,0.08);
      --note-title: #93bbfc;
      --tip-bg: rgba(52,211,153,0.08);
      --important-bg: rgba(99,102,241,0.1);
      --warning-bg: rgba(251,191,36,0.08);
      --caution-bg: rgba(248,113,113,0.08);
      --link-hover: #c7d2fe;
      --h3-border: rgba(99,102,241,0.08);
    }

    /* ─── Light Reading Theme ─── */
    html[data-theme="light"] {
      --bg: #fafaf9;
      --bg-subtle: #f5f5f4;
      --panel: rgba(255, 255, 255, 0.95);
      --panel-border: rgba(0, 0, 0, 0.08);
      --text: #1e293b;
      --text-secondary: #64748b;
      --heading-color: #0f172a;
      --accent: #4f46e5;
      --accent-light: #6366f1;
      --accent-bg: rgba(79, 70, 229, 0.06);
      --green: #059669;
      --amber: #d97706;
      --red: #dc2626;
      --code-bg: rgba(79,70,229,0.08);
      --code-color: #4338ca;
      --pre-bg: #f8fafc;
      --pre-border: rgba(0,0,0,0.08);
      --table-border: rgba(0,0,0,0.08);
      --table-header-bg: rgba(79,70,229,0.06);
      --table-stripe: rgba(0,0,0,0.02);
      --table-hover: rgba(79,70,229,0.04);
      --blockquote-color: #475569;
      --mermaid-bg: rgba(248,250,252,0.8);
      --shadow: 0 4px 20px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
      --callout-shadow: 0 1px 8px rgba(0,0,0,0.06);
      --bg-gradient: none;
      --hero-gradient: linear-gradient(135deg, #4338ca 0%, #6366f1 50%, #818cf8 100%);
      --mark-bg: rgba(251,191,36,0.2);
      --selection-bg: rgba(79,70,229,0.2);
      --selection-color: #0f172a;
      --note-bg: rgba(59,130,246,0.06);
      --note-title: #2563eb;
      --tip-bg: rgba(5,150,105,0.06);
      --important-bg: rgba(79,70,229,0.06);
      --warning-bg: rgba(217,119,6,0.06);
      --caution-bg: rgba(220,38,38,0.06);
      --link-hover: #4338ca;
      --h3-border: rgba(0,0,0,0.06);
      --reader-font: 'Merriweather', Georgia, serif;
      --reader-size: 18px;
    }

    /* ─── Dark Reading Theme (true black) ─── */
    html[data-theme="dark"] {
      --bg: #0a0a0a;
      --bg-subtle: #141414;
      --panel: rgba(20, 20, 20, 0.95);
      --panel-border: rgba(255, 255, 255, 0.08);
      --text: #d4d4d4;
      --text-secondary: #a3a3a3;
      --heading-color: #fafafa;
      --accent: #818cf8;
      --accent-light: #a5b4fc;
      --accent-bg: rgba(129, 140, 248, 0.06);
      --green: #4ade80;
      --amber: #fbbf24;
      --red: #fb7185;
      --code-bg: rgba(255,255,255,0.06);
      --code-color: #c4b5fd;
      --pre-bg: #111111;
      --pre-border: rgba(255,255,255,0.06);
      --table-border: rgba(255,255,255,0.08);
      --table-header-bg: rgba(255,255,255,0.04);
      --table-stripe: rgba(255,255,255,0.02);
      --table-hover: rgba(255,255,255,0.04);
      --blockquote-color: #a3a3a3;
      --mermaid-bg: rgba(20,20,20,0.8);
      --shadow: 0 4px 20px rgba(0,0,0,0.5);
      --callout-shadow: 0 2px 8px rgba(0,0,0,0.3);
      --bg-gradient: none;
      --hero-gradient: linear-gradient(135deg, #e0e7ff 0%, #a5b4fc 50%, #818cf8 100%);
      --mark-bg: rgba(251,191,36,0.15);
      --selection-bg: rgba(129,140,248,0.3);
      --selection-color: #fafafa;
      --note-bg: rgba(96,165,250,0.08);
      --note-title: #93c5fd;
      --tip-bg: rgba(74,222,128,0.08);
      --important-bg: rgba(129,140,248,0.08);
      --warning-bg: rgba(251,191,36,0.08);
      --caution-bg: rgba(251,113,133,0.08);
      --link-hover: #c4b5fd;
      --h3-border: rgba(255,255,255,0.06);
      --reader-font: 'Merriweather', Georgia, serif;
      --reader-size: 18px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.72;
      background: var(--bg);
      background-image: var(--bg-gradient);
      -webkit-font-smoothing: antialiased;
      transition: background 0.35s ease, color 0.35s ease;
    }
    /* Reading mode font override */
    html[data-theme] body {
      font-family: var(--reader-font, 'Inter', sans-serif);
      font-size: var(--reader-size, 16px);
    }
    .page { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; position: relative; }

    /* ─── Scroll fade-in ─── */
    .fade-in {
      opacity: 0; transform: translateY(16px);
      transition: opacity 0.5s ease, transform 0.5s ease;
    }
    .fade-in.visible { opacity: 1; transform: translateY(0); }

    /* ─── Hero ─── */
    .hero {
      margin-bottom: 28px; padding-bottom: 20px;
      border-bottom: 1px solid var(--panel-border);
      position: relative;
      display: flex; justify-content: space-between; align-items: flex-start;
    }
    .hero::after {
      content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      opacity: 0.5;
    }
    .hero-title {
      font-family: 'Merriweather', Georgia, serif;
      font-size: 34px; font-weight: 700;
      letter-spacing: -0.02em;
      background: var(--hero-gradient);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.3;
    }
    .hero-sub { margin-top: 8px; color: var(--text-secondary); font-size: 14px; letter-spacing: 0.02em; }
    .hero-actions { display: flex; gap: 8px; flex-shrink: 0; margin-left: 16px; margin-top: 6px; }
    .hero-btn {
      padding: 8px 14px; border-radius: 8px;
      background: var(--panel); border: 1px solid var(--panel-border);
      color: var(--text-secondary); font-size: 14px; cursor: pointer;
      backdrop-filter: blur(8px); transition: all 0.2s;
      text-decoration: none; white-space: nowrap;
    }
    .hero-btn:hover { color: var(--accent-light); border-color: var(--accent); }

    /* ─── TOC ─── */
    .toc {
      background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius);
      padding: 16px; font-size: 13px; margin-bottom: 24px;
      transition: background 0.35s ease;
    }
    .toc-title { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-light); margin-bottom: 10px; }
    .toc ul { list-style: none; }
    .toc li { margin-bottom: 6px; transition: all 0.2s ease; }
    .toc li.toc-sub { padding-left: 14px; }
    .toc a { color: var(--text-secondary); text-decoration: none; transition: color 0.2s, border-color 0.2s; border-left: 2px solid transparent; padding-left: 8px; }
    .toc a:hover { color: var(--accent-light); }
    .toc li.toc-active > a { color: var(--accent-light); border-left-color: var(--accent); font-weight: 500; }

    /* ─── Article ─── */
    article {
      background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius);
      padding: 32px; backdrop-filter: blur(12px);
      box-shadow: var(--shadow);
      transition: background 0.35s ease, box-shadow 0.35s ease;
    }

    /* ─── Headings ─── */
    article h1, article h2, article h3 {
      font-family: 'Merriweather', Georgia, serif;
      letter-spacing: -0.01em; color: var(--heading-color);
    }
    article h2 {
      margin-top: 40px; padding-top: 24px; padding-left: 16px;
      border-left: 3px solid var(--accent); font-size: 22px;
      position: relative;
    }
    article h2::before {
      content: ''; position: absolute; left: -1px; top: 24px;
      width: 3px; height: 0; background: var(--accent-light);
      transition: height 0.4s ease;
    }
    article h2:hover::before { height: 100%; }
    article h3 {
      margin-top: 28px; font-size: 18px; color: var(--accent-light);
      padding-bottom: 6px;
      border-bottom: 1px solid var(--h3-border);
    }

    /* ─── Text ─── */
    article p, article li { line-height: 1.72; margin-bottom: 8px; }
    article ul, article ol { padding-left: 24px; margin-bottom: 12px; }
    article li::marker { color: var(--accent-light); }
    article strong { color: var(--heading-color); }
    article em { color: var(--text-secondary); }
    article mark, article .highlight { background: var(--mark-bg); color: var(--amber); padding: 1px 5px; border-radius: 4px; }
    article a { color: var(--accent-light); text-decoration: underline; text-underline-offset: 3px; }
    article a:hover { color: var(--link-hover); }

    /* ─── Blockquotes ─── */
    article blockquote {
      margin: 16px 0; padding: 14px 18px;
      border-left: 3px solid var(--accent);
      background: var(--accent-bg); border-radius: 0 var(--radius) var(--radius) 0;
      color: var(--blockquote-color); font-style: italic;
      transition: background 0.35s ease;
    }
    article blockquote p { margin-bottom: 4px; }

    /* ─── Callout blocks ─── */
    .callout {
      margin: 20px 0; padding: 16px 20px; border-radius: var(--radius);
      border-left: 3px solid; position: relative;
      backdrop-filter: blur(8px);
      box-shadow: var(--callout-shadow);
      transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.35s ease;
    }
    .callout:hover { transform: translateX(4px); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .callout-title { font-weight: 600; font-size: 14px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
    .callout-body { font-size: 15px; }
    .callout-body p { margin-bottom: 4px; }
    .callout-note { border-color: #60a5fa; background: var(--note-bg); }
    .callout-note .callout-title { color: var(--note-title); }
    .callout-note .callout-title::before { content: '💡'; }
    .callout-tip { border-color: var(--green); background: var(--tip-bg); }
    .callout-tip .callout-title { color: var(--green); }
    .callout-tip .callout-title::before { content: '✅'; }
    .callout-important { border-color: var(--accent); background: var(--important-bg); }
    .callout-important .callout-title { color: var(--accent-light); }
    .callout-important .callout-title::before { content: '⚡'; }
    .callout-warning { border-color: var(--amber); background: var(--warning-bg); }
    .callout-warning .callout-title { color: var(--amber); }
    .callout-warning .callout-title::before { content: '⚠️'; }
    .callout-caution { border-color: var(--red); background: var(--caution-bg); }
    .callout-caution .callout-title { color: var(--red); }
    .callout-caution .callout-title::before { content: '🔴'; }

    /* ─── Code ─── */
    article code { background: var(--code-bg); color: var(--code-color); padding: 2px 7px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 0.88em; }
    article pre {
      background: var(--pre-bg); color: var(--text); padding: 18px; border-radius: var(--radius);
      overflow: auto; margin: 14px 0; border: 1px solid var(--pre-border);
      transition: background 0.35s ease;
    }
    article pre code { background: transparent; padding: 0; color: inherit; font-size: 14px; }

    /* ─── Tables ─── */
    article .table-scroll { overflow-x: auto; margin: 16px 0; -webkit-overflow-scrolling: touch; }
    article table { border-collapse: collapse; width: 100%; font-size: 14px; min-width: 0; }
    article th, article td { border: 1px solid var(--table-border); padding: 10px 12px; text-align: left; overflow-wrap: break-word; }
    article th { background: var(--table-header-bg); color: var(--accent-light); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
    article tr:nth-child(even) { background: var(--table-stripe); }
    article tr:hover { background: var(--table-hover); }

    /* ─── Mermaid with zoom/pan ─── */
    .mermaid-wrap {
      position: relative; margin: 20px 0;
      background: var(--mermaid-bg); border: 1px solid var(--panel-border);
      border-radius: var(--radius); overflow: hidden;
      transition: background 0.35s ease;
    }
    .mermaid-wrap .mermaid-viewport {
      overflow: hidden; cursor: grab; min-height: 450px;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .mermaid-wrap .mermaid-viewport.grabbing { cursor: grabbing; }
    .mermaid-wrap .mermaid-viewport .mermaid {
      transform-origin: center center;
      transition: transform 0.1s ease;
    }
    .mermaid-controls {
      position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 5;
    }
    .mermaid-controls button {
      width: 28px; height: 28px; border-radius: 6px;
      background: var(--panel); border: 1px solid var(--panel-border);
      color: var(--text-secondary); font-size: 14px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px); transition: all 0.15s;
    }
    .mermaid-controls button:hover { color: var(--accent-light); border-color: var(--accent); }
    .mermaid, pre.mermaid {
      background: transparent; padding: 0; margin: 0;
      text-align: center;
    }

    /* ─── Horizontal rule ─── */
    article hr {
      border: none; height: 1px;
      background: linear-gradient(90deg, transparent 5%, var(--accent) 50%, transparent 95%);
      margin: 36px 0; opacity: 0.5;
    }

    /* ─── Overflow protection ─── */
    article * { min-width: 0; }
    article pre { overflow-x: auto; }
    article img { max-width: 100%; height: auto; }

    /* ─── Selection ─── */
    ::selection { background: var(--selection-bg); color: var(--selection-color); }

    /* ─── Scrollbar ─── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.5); }

    /* ─── Print ─── */
    @media print {
      body { background: #fff; color: #1e293b; }
      .toc, .hero-actions { display: none; }
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
  <script>
    // Apply saved theme immediately to prevent flash
    const savedTheme = localStorage.getItem('abi-reader-theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  </script>
  <main class="page">
    <header class="hero">
      <div>
        <h1 class="hero-title">${escapeHtml(payload.title)}</h1>
        <p class="hero-sub">Сгенерировано ABI Conspector</p>
      </div>
      <div class="hero-actions">
        <button id="theme-toggle" class="hero-btn" title="Сменить тему">🌙</button>
        <button class="hero-btn" onclick="window.close()">← Закрыть</button>
      </div>
    </header>
    ${toc}
    <article>${rendered}</article>
  </main>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

    // ─── Theme Toggle ───
    // 3 modes: default (blue) → dark (black) → light (cream)
    const THEMES = ['', 'dark', 'light'];
    const THEME_ICONS = ['🌙', '☀️', '💻'];
    const THEME_TITLES = ['Тёмный режим', 'Светлый режим', 'Основной режим'];
    const themeBtn = document.getElementById('theme-toggle');

    function getCurrentThemeIdx() {
      const t = document.documentElement.getAttribute('data-theme') || '';
      const idx = THEMES.indexOf(t);
      return idx >= 0 ? idx : 0;
    }
    function applyThemeUI() {
      const idx = getCurrentThemeIdx();
      themeBtn.textContent = THEME_ICONS[idx];
      themeBtn.title = THEME_TITLES[idx];
    }
    applyThemeUI();

    function getMermaidTheme() {
      const t = document.documentElement.getAttribute('data-theme') || '';
      if (t === 'light') return { theme: 'default', themeVariables: { background: '#fafaf9', primaryColor: '#4f46e5', primaryTextColor: '#1e293b', lineColor: '#94a3b8' } };
      if (t === 'dark') return { theme: 'dark', themeVariables: { darkMode: true, background: '#0a0a0a', primaryColor: '#818cf8', primaryTextColor: '#d4d4d4', lineColor: '#525252' } };
      return { theme: 'dark', themeVariables: { darkMode: true, background: '#0f172a', primaryColor: '#6366f1', primaryTextColor: '#e2e8f0', lineColor: '#475569' } };
    }

    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', ...getMermaidTheme() });

    // Save mermaid source before rendering
    document.querySelectorAll('.mermaid, pre code.language-mermaid').forEach(el => {
      const mermaidEl = el.tagName === 'CODE' ? el.parentElement : el;
      if (mermaidEl.tagName === 'PRE') {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = el.textContent;
        mermaidEl.replaceWith(div);
        el = div;
      } else {
        el = mermaidEl;
      }
      // Save original source for theme re-render
      el.setAttribute('data-source', el.textContent);

      const wrap = document.createElement('div');
      wrap.className = 'mermaid-wrap';
      const viewport = document.createElement('div');
      viewport.className = 'mermaid-viewport';
      const controls = document.createElement('div');
      controls.className = 'mermaid-controls';
      controls.innerHTML = '<button data-action="zoom-in" title="Увеличить">+</button>'
        + '<button data-action="zoom-out" title="Уменьшить">−</button>'
        + '<button data-action="reset" title="Сбросить">⟲</button>';

      el.parentNode.insertBefore(wrap, el);
      viewport.appendChild(el);
      wrap.appendChild(viewport);
      wrap.appendChild(controls);

      // Zoom/pan state
      let scale = 1, panX = 0, panY = 0, dragging = false, startX = 0, startY = 0;
      const applyTransform = () => {
        el.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`;
      };

      controls.addEventListener('click', e => {
        const action = e.target.closest('button')?.dataset.action;
        if (action === 'zoom-in') scale = Math.min(scale * 1.3, 5);
        else if (action === 'zoom-out') scale = Math.max(scale / 1.3, 0.3);
        else if (action === 'reset') { scale = 1; panX = 0; panY = 0; }
        applyTransform();
      });

      viewport.addEventListener('wheel', e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        scale = Math.max(0.3, Math.min(5, scale * delta));
        applyTransform();
      }, { passive: false });

      viewport.addEventListener('mousedown', e => {
        if (scale <= 1) return;
        dragging = true; startX = e.clientX - panX; startY = e.clientY - panY;
        viewport.classList.add('grabbing');
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        panX = e.clientX - startX; panY = e.clientY - startY;
        applyTransform();
      });
      document.addEventListener('mouseup', () => {
        dragging = false; viewport.classList.remove('grabbing');
      });
    });

    await mermaid.run();

    // ─── TOC active section tracking ───
    const tocLinks = document.querySelectorAll('.toc a');
    const headings = Array.from(document.querySelectorAll('h2[id], h3[id]'));
    if (tocLinks.length > 0 && headings.length > 0) {
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            tocLinks.forEach(a => a.parentElement.classList.remove('toc-active'));
            const active = document.querySelector(\`.toc a[href="#\${entry.target.id}"]\`);
            if (active) active.parentElement.classList.add('toc-active');
          }
        }
      }, { rootMargin: '-10% 0px -80% 0px' });
      headings.forEach(h => observer.observe(h));
    }

    // ─── Scroll fade-in animations ───
    const fadeEls = document.querySelectorAll('article h2, article h3, .callout, .mermaid-wrap, article table');
    fadeEls.forEach(el => el.classList.add('fade-in'));
    const fadeObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          fadeObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.1 });
    fadeEls.forEach(el => fadeObserver.observe(el));

    // ─── Theme toggle handler ───
    themeBtn.addEventListener('click', async () => {
      const nextIdx = (getCurrentThemeIdx() + 1) % THEMES.length;
      const nextTheme = THEMES[nextIdx];
      if (nextTheme) {
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('abi-reader-theme', nextTheme);
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('abi-reader-theme');
      }
      applyThemeUI();

      // Re-render mermaid from saved source
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', ...getMermaidTheme() });
      document.querySelectorAll('.mermaid[data-source]').forEach(el => {
        el.textContent = el.getAttribute('data-source');
        el.removeAttribute('data-processed');
      });
      try { await mermaid.run(); } catch (_) { /* ignore */ }
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
