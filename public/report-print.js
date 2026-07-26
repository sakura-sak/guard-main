/**
 * Unified printable HTML report (download + QR scan).
 * Used by public/report.html
 */
(function (global) {
  'use strict';

  const METRIC_RING_LENGTH = 2 * Math.PI * 42;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  function ringSvg(p, color, w, size) {
    const pct = Math.max(0, Math.min(100, Number(p) || 0));
    const offset = METRIC_RING_LENGTH * (1 - pct / 100);
    return `
      <svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" stroke-width="${w}"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="${w}"
          stroke-linecap="round" stroke-dasharray="${METRIC_RING_LENGTH}"
          stroke-dashoffset="${offset}"
          transform="rotate(-90 50 50)"/>
      </svg>`;
  }

  function qrSrc(dataUrl, url) {
    if (dataUrl) return dataUrl;
    if (url && global.ApApi && global.ApApi.qrImageUrl) return global.ApApi.qrImageUrl(url);
    return '';
  }

  function reportStyles() {
    return `
  :root {
    --primary: #2563eb;
    --primary-soft: #dbeafe;
    --ink: #0a1f44;
    --ink-2: #1e293b;
    --muted: #64748b;
    --bg-2: #f4f8fd;
    --border: rgba(15, 41, 92, 0.08);
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif;
    color: var(--ink); background: #fff;
    margin: 0; line-height: 1.55;
  }
  .report-body {
    padding: 40px 48px; max-width: 960px; margin: 0 auto;
  }
  h1 { font-size: 20px; letter-spacing: -0.3px; margin: 0 0 6px; line-height: 1.3; }
  h2 { font-size: 16px; margin: 0 0 14px; color: var(--ink); }
  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 24px;
  }
  .brand {
    display: inline-flex; align-items: center; gap: 10px;
    background: var(--primary-soft); color: var(--primary);
    font-size: 12px; font-weight: 700; letter-spacing: 0.8px;
    padding: 6px 16px 6px 10px; border-radius: 999px;
  }
  .brand img { width: 28px; height: 28px; flex-shrink: 0; object-fit: contain; }
  .meta-id { font-size: 12px; color: var(--muted); }
  .meta-id code {
    background: var(--bg-2); padding: 2px 8px; border-radius: 6px;
    font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: var(--ink-2);
  }
  .subtitle { color: var(--muted); margin: 0 0 24px; font-size: 14px; }
  .card {
    background: #fff; border: 1px solid var(--border); border-radius: 22px;
    padding: 22px 24px; margin-bottom: 18px;
  }
  .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
  .metric {
    background: #fff; border: 1px solid var(--border); border-radius: 18px;
    padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px;
  }
  .metric--main { background: var(--bg-2); }
  .metric__circle { width: 110px; height: 110px; position: relative; display: grid; place-items: center; }
  .metric__circle svg { position: absolute; inset: 0; }
  .metric__val {
    position: relative; z-index: 1; font-size: 24px; font-weight: 700; color: var(--ink);
    display: inline-flex; align-items: baseline; gap: 1px;
  }
  .metric__val span:last-child { font-size: 13px; }
  .metric__label { font-size: 14px; color: var(--ink-2); font-weight: 500; }
  .metric--main .metric__label { font-weight: 700; color: var(--ink); }
  .meta { display: grid; grid-template-columns: 200px 1fr; gap: 12px 24px; font-size: 14px; margin: 0; }
  .meta dt { margin: 0; color: var(--muted); }
  .meta dd { margin: 0; color: var(--ink); font-weight: 500; }
  .signature {
    display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
    margin: 12px 0 24px; font-size: 13px;
  }
  .signature__row { display: flex; align-items: end; gap: 12px; }
  .signature__label { color: var(--ink-2); white-space: nowrap; }
  .signature__line { flex: 1; border-bottom: 1px solid #94a3b8; height: 18px; }
  .src-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
  .src-table thead th {
    text-align: left; color: var(--muted); font-weight: 600; font-size: 11px;
    padding: 10px 12px; background: var(--bg-2);
    border-bottom: 1px solid var(--border);
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .src-table thead th:first-child { border-top-left-radius: 12px; }
  .src-table thead th:last-child { border-top-right-radius: 12px; }
  .src-table tbody td {
    padding: 12px; border-bottom: 1px solid var(--border);
    vertical-align: top; color: var(--ink-2);
  }
  .src-table tbody tr:last-child td { border-bottom: none; }
  .src-table__num { color: var(--muted); font-weight: 700; width: 36px; }
  .src-table code {
    background: var(--bg-2); padding: 2px 8px; border-radius: 6px;
    font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; color: var(--ink-2);
  }
  .src-table__pct { text-align: right; white-space: nowrap; }
  .src-table__pct span {
    background: #fee2e2; color: #b91c1c;
    padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
    display: inline-block;
  }
  .qrs { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 18px 0; }
  .qr {
    background: #fff; border: 1px solid var(--border); border-radius: 18px;
    padding: 16px; text-align: center; font-size: 12px; color: var(--muted);
    display: flex; flex-direction: column; align-items: center; gap: 10px; line-height: 1.4;
  }
  .qr[hidden] { display: none; }
  .qr img { width: 160px; height: 160px; }
  footer {
    margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border);
    font-size: 12px; color: var(--muted);
    display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }
  @page { size: A4; margin: 10mm; }
  @media print {
    .report-body { padding: 0; max-width: none; }
    .qr { break-inside: avoid; }
    .src-table tr { break-inside: avoid; }
    h2 { break-after: avoid; }
    .metric--main { background: var(--bg-2) !important; }
    .src-table__pct span, .metric__circle circle {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }`;
  }

  function buildDocumentHtml(data) {
    const id = data.reportId ?? data.id ?? '—';
    const orig = data.orig ?? 0;
    const matches = data.matches ?? 0;
    const ai = data.ai ?? 0;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const logoPath = data.logoUrl || '/bsuir-logo.jpg';
    const logoUrl = logoPath.startsWith('http') ? logoPath : new URL(logoPath, location.href).href;
    const qrVerify = qrSrc(data.verifyQrImage, data.verifyUrl);
    const qrDoc = qrSrc(data.originalQrImage, data.originalUrl);

    const sourcesHtml = sources.map((m, i) => `
      <tr>
        <td class="src-table__num">${String(i + 1).padStart(2, '0')}</td>
        <td class="src-table__title">${escapeHtml(m.title || '—')}</td>
        <td>${escapeHtml(m.docType || '—')}</td>
        <td><code>${escapeHtml(m.docId)}</code></td>
        <td class="src-table__pct"><span>${escapeHtml(m.percentLabel != null ? m.percentLabel : (m.percent != null ? `${m.percent}%` : '—'))}</span></td>
      </tr>
    `).join('');

    return `
<style>${reportStyles()}</style>
<div class="report-body">
  <div class="head">
    <span class="brand"><img src="${logoUrl}" alt="БГУИР"/>АНТИПЛАГИАТ · БГУИР</span>
    <div class="meta-id">ID отчёта <code>${escapeHtml(id)}</code></div>
  </div>
  <h1>${escapeHtml(data.title)}</h1>
  <p class="subtitle">Отчёт о проверке на оригинальность</p>
  <div class="card">
    <div class="metrics">
      <div class="metric">
        <div class="metric__circle">
          ${ringSvg(ai, '#8b5cf6', 10, 110)}
          <span class="metric__val"><span>${ai}</span><span>%</span></span>
        </div>
        <div class="metric__label">ИИ-генерация</div>
      </div>
      <div class="metric metric--main">
        <div class="metric__circle">
          ${ringSvg(orig, '#2563eb', 12, 110)}
          <span class="metric__val"><span>${orig}</span><span>%</span></span>
        </div>
        <div class="metric__label">Оригинальность</div>
      </div>
      <div class="metric">
        <div class="metric__circle">
          ${ringSvg(matches, '#dc2626', 10, 110)}
          <span class="metric__val"><span>${matches}</span><span>%</span></span>
        </div>
        <div class="metric__label">Совпадения</div>
      </div>
    </div>
  </div>
  <div class="card">
    <h2>Сведения о работе</h2>
    <dl class="meta">
      <dt>Автор</dt><dd>${escapeHtml(data.author || '—')}</dd>
      <dt>Учебное заведение</dt><dd>${escapeHtml(data.institution || '—')}</dd>
      <dt>Тип работы</dt><dd>${escapeHtml(data.type || '—')}</dd>
      <dt>Количество слов</dt><dd>${data.wordCount ? Number(data.wordCount).toLocaleString('ru-RU') : '—'}</dd>
      <dt>Дата проверки</dt><dd>${formatDate(data.savedAt)}</dd>
    </dl>
  </div>
  <div class="signature">
    <div class="signature__row">
      <span class="signature__label">Дата:</span>
      <span class="signature__line"></span>
    </div>
    <div class="signature__row">
      <span class="signature__label">Подпись проверяющего:</span>
      <span class="signature__line"></span>
    </div>
  </div>
  <div class="card">
    <h2>Найденные заимствования</h2>
    <table class="src-table">
      <thead>
        <tr>
          <th>№</th>
          <th>Название работы</th>
          <th>Тип работы</th>
          <th>ID документа</th>
          <th style="text-align: right;">Схожесть</th>
        </tr>
      </thead>
      <tbody>${sourcesHtml}</tbody>
    </table>
  </div>
  <div class="qrs">
    <div class="qr"${qrVerify ? '' : ' hidden'}>
      ${qrVerify ? `<img src="${qrVerify}" alt=""/>` : ''}
      Для подтверждения подлинности и актуальности данной справки отсканируйте QR-код
    </div>
    <div class="qr"${qrDoc ? '' : ' hidden'}>
      ${qrDoc ? `<img src="${qrDoc}" alt=""/>` : ''}
      Для просмотра оригинальной электронной версии документа отсканируйте QR-код
    </div>
  </div>
  <footer>
    <span>antiplagiat.bsuir.by</span>
    <span>${escapeHtml(data.verifyUrl || '')}</span>
  </footer>
</div>`;
  }

  function waitForImages(root) {
    const imgs = root ? Array.from(root.querySelectorAll('img')) : [];
    if (!imgs.length) return Promise.resolve();
    return Promise.all(imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }

  global.ApReportPrint = {
    buildDocumentHtml,
    waitForImages,
    ringSvg,
    METRIC_RING_LENGTH,
  };
})(window);
