/**
 * ApFileParser — клиентский парсер файлов для БГУИР Антиплагиат.
 * Адаптация lib/file-parser.ts для статического браузерного окружения.
 *
 * Зависимости (загружаются автоматически через CDN):
 *   - mammoth.js   — извлечение текста из DOCX/DOC
 *   - PDF.js       — извлечение текста из PDF
 *
 * Подключать ПЕРЕД api.js:
 *   <script src="file-parser.js"></script>
 */
(function (global) {
  'use strict';

  const MAX_SIZE_MB = 50;
  const MAMMOTH_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  const PDFJS_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ─── Dynamic script loader ─────────────────────────────────────────────────

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Не удалось загрузить: ${src}`));
      document.head.appendChild(s);
    });
  }

  // ─── PDF parser ────────────────────────────────────────────────────────────

  async function parsePDF(file) {
    await loadScript(PDFJS_CDN);
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib || window.PDFJS;
    if (!pdfjsLib) throw new Error('PDF.js не загружен');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      parts.push(tc.items.map((it) => it.str).join(' '));
    }
    return parts.join('\n\n');
  }

  // ─── DOCX/DOC parser ───────────────────────────────────────────────────────

  async function parseDOCX(file) {
    await loadScript(MAMMOTH_CDN);
    const mammoth = window.mammoth;
    if (!mammoth) throw new Error('mammoth.js не загружен');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Validate file before parsing (size, extension).
   * @param {File} file
   * @returns {{ valid: boolean, error?: string }}
   */
  function validateFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx', 'doc'].includes(ext)) {
      return { valid: false, error: 'Поддерживаются только файлы DOCX и PDF' };
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return { valid: false, error: `Максимальный размер файла — ${MAX_SIZE_MB} МБ` };
    }
    return { valid: true };
  }

  /**
   * Parse a file and extract its text content.
   * @param {File} file
   * @returns {Promise<{ text: string, wordCount: number, filename: string, fileType: string }>}
   */
  async function parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let text;

    if (ext === 'pdf') {
      text = await parsePDF(file);
    } else if (ext === 'docx' || ext === 'doc') {
      text = await parseDOCX(file);
    } else {
      throw new Error(`Неподдерживаемый формат: ${ext}`);
    }

    // Basic cleanup (mirrors lib/file-parser.ts)
    text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

    return { text, wordCount, filename: file.name, fileType: ext === 'pdf' ? 'pdf' : 'word' };
  }

  // ─── Expose ────────────────────────────────────────────────────────────────

  global.ApFileParser = { validateFile, parseFile };

})(window);
