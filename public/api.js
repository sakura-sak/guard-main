/**
 * ApApi — клиент к реальному бэкенду БГУИР Антиплагиат.
 * Все запросы используют credentials:'include' (session cookie).
 * Подключать: <script src="api.js"></script>
 * Использовать: const { ok, data } = await ApApi.login('user', 'pass');
 */
(function (global) {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function req(method, url, body, isFormData) {
    const opts = { method, credentials: 'include' };
    if (body != null) {
      if (isFormData) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }
    try {
      const res = await fetch(url, opts);
      let data;
      try { data = await res.json(); } catch { data = { success: false, error: 'Ошибка ответа сервера' }; }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { success: false, error: err.message || 'Сеть недоступна' } };
    }
  }

  const GET    = (url)             => req('GET',    url);
  const POST   = (url, body, form) => req('POST',   url, body, form);
  const PATCH  = (url, body)       => req('PATCH',  url, body);
  const DELETE = (url)             => req('DELETE', url);

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Login.
   * @returns {{ ok, data: { success, user: { username, role, additionalRoles, fullName, email, institution, faculty, group } } }}
   */
  const login = (username, password) =>
    POST('/api/auth/login', { username, password });

  /**
   * Logout. Clears the session cookie server-side.
   */
  const logout = () => POST('/api/auth/logout', {});

  /**
   * Get current session user.
   * Returns 401 if not authenticated.
   * @returns {{ ok, data: { success, user } }}
   */
  const getMe = () => GET('/api/auth/me');

  // ─── User profile ─────────────────────────────────────────────────────────

  /** Get current user's full profile. */
  const getProfile = () => GET('/api/users/me');

  /**
   * Update current user's profile.
   * @param {{ fullName?, email?, institution?, faculty?, facultyId?, group? }} data
   */
  const updateProfile = (data) => PATCH('/api/users/me', data);

  // ─── Directories & types ──────────────────────────────────────────────────

  /**
   * Get all institutions with their faculties.
   * @returns {{ ok, data: { success, institutions: [{ id, name, faculties: [{id,name}] }] } }}
   */
  const getDirectories = () => GET('/api/directories');

  /**
   * Get catalog of academic document types.
   * @returns {{ ok, data: { success, types: [{ id, name, displayName }] } }}
   */
  const getDocumentTypes = (institutionId, institution) => {
    const qs = new URLSearchParams();
    if (institutionId) qs.set('institutionId', institutionId);
    else if (institution) qs.set('institution', institution);
    const q = qs.toString();
    return GET(q ? `/api/document-types?${q}` : '/api/document-types');
  };

  // ─── Check ────────────────────────────────────────────────────────────────

  /**
   * Check document text for plagiarism (does NOT save to DB).
   * @param {{ content: string, filename: string, category: string, institution?: string, institutionId?: string }} params
   * @returns {{ ok, data: { success, uniquenessPercent, plagiarismPercent,
   *   mlPlagiarismPercent, mlAiPercent, processingTimeMs,
   *   totalDocumentsChecked, similarDocuments, semanticMatches, byType } }}
   */
  const checkDocument = (params) => POST('/api/check', params);

  // ─── Upload ───────────────────────────────────────────────────────────────

  /**
   * Upload & enqueue async analysis (202). FormData:
   *   file, title, content, category, institution?, institutionId?, document_type?
   * @param {FormData} formData
   * @returns {{ ok, status, data: { success, status, jobId, document } }}
   */
  const uploadDocument = (formData) => POST('/api/upload', formData, true);

  /** Active processing job or latest unviewed completed result. */
  const getAnalysisState = () => GET('/api/analysis/state');

  /** Per-document analysis state. */
  const getDocumentAnalysis = (documentId) =>
    GET(`/api/documents/${documentId}/analysis`);

  /** Mark completed result as viewed (stage 3 shown). */
  const markAnalysisViewed = (documentId) =>
    POST(`/api/documents/${documentId}/analysis/viewed`, {});

  // ─── Documents ────────────────────────────────────────────────────────────

  /**
   * Get all documents belonging to a specific user.
   * @returns {{ ok, data: { success, documents: [...] } }}
   */
  const getUserDocuments = (username) =>
    GET(`/api/documents/user/${encodeURIComponent(username)}`);

  /**
   * Finalize or archive a document.
   * @param {number} documentId
   * @param {"final"|"archived"} status
   */
  const updateDocumentStatus = (documentId, status) =>
    PATCH(`/api/documents/${documentId}/status`, { status });

  /**
   * Update document metadata (title, category slug).
   */
  const updateAdminDocument = (documentId, data) =>
    PATCH(`/api/documents/${documentId}`, data);

  /** Update document title (owner or admin). */
  const updateDocumentTitle = (documentId, title) =>
    PATCH(`/api/documents/${documentId}`, { title });

  /**
   * Delete a document owned by the current user.
   */
  const deleteUserDocument = (username, documentId) =>
    DELETE(`/api/documents/user/${encodeURIComponent(username)}/documents/${documentId}`);

  /**
   * Borrowings / AI fragments for a document.
   * @returns {{ ok, data: { success, borrowMatches, aiMatches, similarDocuments, plagiarismPercent, aiPercent, byType } }}
   */
  const getDocumentMatches = (documentId) =>
    GET(`/api/documents/${documentId}/matches`);

  /**
   * Generate (or retrieve cached) PDF report.
   * @returns {{ ok, data: { success, reportUrl, downloadUrl, accessToken } }}
   */
  const generateReport = (documentId) =>
    POST('/api/report', { documentId });

  /** Signed URLs for report QR codes (verify + original file). */
  const getReportQrLinks = (documentId) =>
    GET(`/api/report/${documentId}/links`);

  const resolveReportQrUrls = async (documentId) => {
    const empty = { verifyUrl: '', docUrl: '', verifyQrImage: '', originalQrImage: '' };
    if (!documentId) return empty;
    const { ok, data } = await getReportQrLinks(documentId);
    if (ok && data.success) {
      return {
        verifyUrl: data.verifyUrl || '',
        docUrl: data.originalUrl || '',
        verifyQrImage: data.verifyQrImage || '',
        originalQrImage: data.originalQrImage || '',
      };
    }
    return empty;
  };

  function applyQrToImg(imgEl, targetUrl, dataUrl) {
    if (!imgEl) return;
    if (dataUrl) {
      imgEl.src = dataUrl;
      imgEl.hidden = false;
      return;
    }
    if (targetUrl) {
      imgEl.src = qrImageUrl(targetUrl);
      imgEl.hidden = false;
      return;
    }
    imgEl.removeAttribute('src');
    imgEl.hidden = true;
  }

  /** Локальный PNG QR (GET /api/report/qr) — не зависит от api.qrserver.com */
  function qrImageUrl(targetUrl) {
    if (!targetUrl) return '';
    return `/api/report/qr?data=${encodeURIComponent(targetUrl)}`;
  }

  /*
  const CATEGORY_LABELS = {
    diploma: 'Дипломная работа',
    coursework: 'Курсовая работа / Проект',
    lab: 'Лабораторная работа',
    practice: 'Практическое задание',
    uncategorized: 'Не указано',
  };
  */

  let __categoryLabels = null;
  let __categoryLabelsPromise = null;

  /** Подставить кэш из уже загруженного списка типов (без повторного запроса). */
  function setCategoryLabelsFromTypes(types) {
    const map = {};
    if (Array.isArray(types)) {
      types.forEach((t) => {
        if (t?.name) map[t.name] = t.displayName || t.name;
      });
    }
    __categoryLabels = map;
  }

  /** Загрузить slug → displayName из GET /api/document-types (PostgreSQL). */
  async function loadCategoryLabels() {
    if (__categoryLabels) return __categoryLabels;
    if (__categoryLabelsPromise) return __categoryLabelsPromise;
    __categoryLabelsPromise = (async () => {
      const map = {};
      const { ok, data } = await getDocumentTypes();
      if (ok && Array.isArray(data?.types)) {
        data.types.forEach((t) => {
          if (t?.name) map[t.name] = t.displayName || t.name;
        });
      }
      __categoryLabels = map;
      __categoryLabelsPromise = null;
      return map;
    })();
    return __categoryLabelsPromise;
  }

  function categoryLabel(cat) {
    if (!cat) return '—';
    if (__categoryLabels && __categoryLabels[cat]) return __categoryLabels[cat];
    // return CATEGORY_LABELS[cat] || cat;
    return cat;
  }

  /** Map GET /matches response to printable report table rows (real documents only, no ML duplicate). */
  function mapBorrowRowsFromMatchesApi(data) {
    const simById = new Map((data.similarDocuments || []).map((s) => [s.id, s]));
    const rows = [];
    (data.borrowMatches || []).forEach((m) => {
      if (!m.sourceId || m.sourceId <= 0) return;
      const sim = simById.get(m.sourceId);
      const pct = Math.round(m.similarity ?? 0);
      const typeLabel = m.matchTypeLabel || '';
      const cat = m.categoryLabel || categoryLabel(m.category || sim?.categoryLabel || sim?.category);
      rows.push({
        title: m.sourceTitle || '—',
        // quote: m.quote || m.sourceTitle || '—',
        docId: String(m.sourceId),
        docType: typeLabel && typeLabel !== 'Локальное' ? `${cat} · ${typeLabel}` : cat,
        percent: pct,
        percentLabel: typeLabel ? `${pct}% · ${typeLabel}` : `${pct}%`,
        matchType: m.matchType || null,
        matchTypeLabel: typeLabel || null,
        kind: m.matchType && m.matchType !== 'local' ? 'ml' : 'local',
      });
    });
    return rows.slice(0, 5);
  }

  /**
   * Rows for «Найденные заимствования» when API returned no document matches.
   * Avoids misleading 0% row while header shows ML-based совпадения.
   */
  function buildReportTableRows(rows, stats) {
    if (rows && rows.length) return rows;
    const matches = stats?.matches ?? 0;
    const ml = stats?.ml ?? 0;
    const local = stats?.local ?? 0;
    if (matches > 0) {
      const viaMl = ml >= local && ml > 0;
      return [{
        title: viaMl ? 'Семантический анализ' : 'Итоговая оценка',
        // quote: viaMl
        //   ? `Конкретные работы в базе сравнения не найдены. Показатель «Совпадения» (${matches}%) сформирован векторным поиском.`
        //   : `Конкретные источники в таблице не найдены. Показатель «Совпадения»: ${matches}%.`,
        docType: '—',
        docId: '—',
        percent: matches,
        percentLabel: `${matches}%`,
      }];
    }
    return [{
      title: 'Заимствования не обнаружены',
      // quote: 'Заимствования не обнаружены',
      docType: '—',
      docId: '—',
      percent: 0,
      percentLabel: '0%',
    }];
  }

  function formatReportPercentCell(row) {
    if (row.percentLabel != null) return row.percentLabel;
    if (row.percent != null && Number.isFinite(row.percent)) return `${row.percent}%`;
    return '—';
  }

  /**
   * Load borrowings for printable PDF report.
   * @returns {{ rows: Array, stats: { orig, matches, ai, local, ml } | null, error?: string }}
   */
  async function fetchReportMatchRows(documentId) {
    if (!documentId) {
      return { rows: [], stats: null };
    }
    await loadCategoryLabels();
    const { ok, data } = await getDocumentMatches(documentId);
    if (!ok || !data?.success) {
      return { rows: [], stats: null, error: data?.error || 'Не удалось загрузить заимствования' };
    }
    const local = data.localPlagiarismPercent ?? 0;
    const ml = data.mlPlagiarismPercent ?? 0;
    const matches = data.plagiarismPercent ?? Math.max(local, ml);
    const stats = {
      orig: data.originalityPercent != null ? Math.round(data.originalityPercent) : null,
      matches: Math.round(matches),
      ai: data.aiPercent != null ? Math.round(data.aiPercent) : null,
      local: Math.round(local),
      ml: Math.round(ml),
    };
    return { rows: mapBorrowRowsFromMatchesApi(data), stats };
  }

  // ─── Admin: users ─────────────────────────────────────────────────────────

  /**
   * Get all users (admin only).
   * @param {{ search?, role?, institution?, faculty? }} [params]
   */
  const getAdminUsers = (params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ) : '';
    return GET(`/api/admin/users${qs}`);
  };

  /** Create a new user (admin only). */
  const createAdminUser = (data) => POST('/api/admin/users', data);

  /** Update an existing user (admin only). */
  const updateAdminUser = (username, data) =>
    PATCH(`/api/admin/users/${encodeURIComponent(username)}`, data);

  /** Delete a user (admin only). */
  const deleteAdminUser = (username) =>
    DELETE(`/api/admin/users/${encodeURIComponent(username)}`);

  // ─── Admin: documents ─────────────────────────────────────────────────────

  /**
   * Get all documents (admin only).
   * @param {{ status?, category?, userId? }} [params]
   */
  const getAdminDocuments = (params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ) : '';
    return GET(`/api/documents${qs}`);
  };

  /** Delete a document by ID (admin only). */
  const deleteAdminDocument = (id) => DELETE(`/api/documents?id=${id}`);

  // ─── Admin: directories ───────────────────────────────────────────────────

  /** Get full institutions+faculties tree (admin). */
  const getAdminDirectories = () => GET('/api/admin/directories');

  /** Save institutions/faculties changes (admin). */
  const saveAdminDirectories = (data) => POST('/api/admin/directories', data);

  // ─── Admin: document types ────────────────────────────────────────────────

  /** Get all document types (admin). */
  const getAdminDocumentTypes = (institutionId) => {
    const q = institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : '';
    return GET(`/api/admin/document-types${q}`);
  };

  /** Create a new document type (admin). */
  const createAdminDocumentType = (data) => POST('/api/admin/document-types', data);

  /** Update a document type (admin). */
  const updateAdminDocumentType = (id, data) =>
    PATCH(`/api/admin/document-types/${id}`, data);

  /** Delete a document type (admin). */
  const deleteAdminDocumentType = (id) =>
    DELETE(`/api/admin/document-types/${id}`);

  // ─── Admin: statistics, logs, storage ────────────────────────────────────

  /**
   * Get system statistics for admin monitoring dashboard.
   * @param {{ startDate?, endDate?, from?, to?, category?, status?, minUniqueness?, maxUniqueness?, minPlagiarism?, maxPlagiarism? }} [params]
   */
  const getAdminStatistics = (params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ) : '';
    return GET(`/api/admin/statistics${qs}`);
  };

  /** Get system logs (admin). */
  const getAdminLogs = (params) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ) : '';
    return GET(`/api/admin/logs${qs}`);
  };

  /** Get storage statistics (admin). */
  const getAdminStorageStats = () => GET('/api/admin/storage/stats');

  /** Run archived storage purge (admin): removes files/text, keeps stats in DB. */
  const runAdminCleanup = () => POST('/api/admin/cleanup', {});

  /** Open unified HTML report in a new tab (same view as QR scan). */
  function openPrintableReportById(documentId) {
    const id = documentId != null ? String(documentId).trim() : '';
    if (!id) return false;
    window.open('report.html?documentId=' + encodeURIComponent(id), '_blank', 'noopener,noreferrer');
    return true;
  }

  const METRIC_RING_LENGTH = 2 * Math.PI * 42;

  function readMetricCircleVars(containerEl) {
    const cs = getComputedStyle(containerEl);
    const color = cs.getPropertyValue('--color').trim() || '#2563eb';
    const ringW = cs.getPropertyValue('--ring-w').trim() || '10';
    return { color, ringW };
  }

  /** Firefox-safe metric ring — dash via inline style (CSS must not set dashoffset). */
  function setMetricCircle(containerEl, percent) {
    if (!containerEl) return;
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const bg = containerEl.querySelector('.metric-circle__bg');
    const fg = containerEl.querySelector('.metric-circle__fg');
    if (!fg) return;
    const { color, ringW } = readMetricCircleVars(containerEl);
    if (bg) {
      bg.setAttribute('stroke', '#e2e8f0');
      bg.setAttribute('stroke-width', ringW);
    }
    fg.setAttribute('stroke', color);
    fg.setAttribute('stroke-width', ringW);
    fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('fill', 'none');
    const dash = String(METRIC_RING_LENGTH);
    const offset = String(METRIC_RING_LENGTH * (1 - p / 100));
    fg.style.strokeDasharray = dash;
    fg.style.strokeDashoffset = offset;
  }

  function initMetricCirclesIn(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.metric-circle').forEach((el) => setMetricCircle(el, 0));
  }

  /** Open printable report HTML in a new tab (avoids about:blank from document.write). */
  function openReportPrintWindow(html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      URL.revokeObjectURL(url);
      return;
    }
    w.addEventListener('load', () => {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, { once: true });
  }

  /** Trigger browser download of the original uploaded file. */
  async function downloadDocumentFile(documentId, fallbackName) {
    const id = documentId != null ? String(documentId).trim() : '';
    if (!id) return { ok: false, error: 'Нет ID документа' };
    const res = await fetch('/api/documents/' + encodeURIComponent(id) + '/file', {
      credentials: 'include',
    });
    if (!res.ok) {
      let err = 'Не удалось скачать файл';
      try {
        const data = await res.json();
        if (data.error) err = data.error;
      } catch { /* binary body */ }
      return { ok: false, error: err };
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    let filename = fallbackName || 'document';
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const asciiMatch = /filename="([^"]+)"/i.exec(cd);
    if (utf8Match) {
      try { filename = decodeURIComponent(utf8Match[1]); } catch { filename = utf8Match[1]; }
    } else if (asciiMatch) {
      filename = asciiMatch[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    return { ok: true };
  }

  // ─── Expose ───────────────────────────────────────────────────────────────

  global.ApApi = {
    // auth
    login, logout, getMe,
    // user
    getProfile, updateProfile,
    // directories & types
    getDirectories, getDocumentTypes,
    // check & upload
    checkDocument, uploadDocument,
    getAnalysisState, getDocumentAnalysis, markAnalysisViewed,
    // documents
    getUserDocuments, updateDocumentStatus, updateDocumentTitle,
    deleteUserDocument, getDocumentMatches, generateReport, getReportQrLinks, resolveReportQrUrls,
    downloadDocumentFile,
    fetchReportMatchRows, mapBorrowRowsFromMatchesApi, buildReportTableRows, formatReportPercentCell,
    loadCategoryLabels, setCategoryLabelsFromTypes, categoryLabel, qrImageUrl, applyQrToImg, openReportPrintWindow,
    openPrintableReportById, setMetricCircle, initMetricCirclesIn, METRIC_RING_LENGTH,
    updateAdminDocument,
    // admin: users
    getAdminUsers, createAdminUser, updateAdminUser, deleteAdminUser,
    // admin: documents
    getAdminDocuments, deleteAdminDocument,
    // admin: directories
    getAdminDirectories, saveAdminDirectories,
    // admin: document types
    getAdminDocumentTypes, createAdminDocumentType,
    updateAdminDocumentType, deleteAdminDocumentType,
    // admin: stats, logs, storage
    getAdminStatistics, getAdminLogs, getAdminStorageStats, runAdminCleanup,
  };

})(window);
