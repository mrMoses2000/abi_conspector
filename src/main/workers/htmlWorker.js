import fs from 'node:fs/promises';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

/**
 * @param {{
 *   mergedPath: string;
 *   htmlPath: string;
 *   title: string;
 * }} payload
 */
export async function renderHtmlFromMarkdown(payload) {
  const mergedMd = await fs.readFile(payload.mergedPath, 'utf8');
  const rendered = md.render(mergedMd);

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(payload.title)}</title>
  <style>
    :root { --bg:#f3f6ff; --panel:#ffffff; --text:#151927; --muted:#536079; --accent:#0a69ff; }
    * { box-sizing: border-box; }
    body { margin:0; color:var(--text); font-family:'Avenir Next','Segoe UI',sans-serif;
      background: radial-gradient(80rem 40rem at 10% -15%, #dfeaff 0%, transparent 65%),
                  radial-gradient(60rem 36rem at 110% -5%, #d9f3ff 0%, transparent 55%), var(--bg);
    }
    .wrap { max-width: 980px; margin: 36px auto; padding: 0 18px 48px; }
    .hero { margin-bottom: 16px; }
    .title { margin:0; font-size: 34px; letter-spacing: -0.02em; }
    .subtitle { margin-top: 8px; color: var(--muted); }
    article { background: var(--panel); border-radius: 16px; padding: 24px; box-shadow: 0 14px 28px rgba(8,34,86,0.11); }
    h1, h2, h3 { letter-spacing: -0.01em; }
    h2 { margin-top: 30px; padding-top: 8px; border-top: 1px solid #e6edf9; }
    p, li { line-height: 1.62; }
    blockquote { margin: 14px 0; padding: 10px 14px; border-left: 4px solid var(--accent); background: #edf3ff; color:#233250; border-radius: 8px; }
    code { background: #eef3ff; padding: 2px 6px; border-radius: 6px; }
    pre { background:#0f172a; color:#dbeafe; padding: 14px; border-radius: 12px; overflow:auto; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #dce6f7; padding: 8px 10px; text-align: left; }
    th { background: #f4f8ff; }
    .mermaid { background: #fbfdff; border: 1px solid #e4ecfb; border-radius: 10px; padding: 10px; }
    @media (max-width: 760px) { .title { font-size: 28px; } article { padding: 16px; } }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="hero">
      <h1 class="title">${escapeHtml(payload.title)}</h1>
      <p class="subtitle">Сгенерировано ABI Conspector</p>
    </header>
    <article>${rendered}</article>
  </main>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
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
    body { margin: 0; background: #f7f9fc; color: #161a26; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    main { max-width: 900px; margin: 24px auto; padding: 0 16px; }
    section { background: #fff; border: 1px solid #d8e0ee; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f2f5fb; border-radius: 8px; padding: 12px; }
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
