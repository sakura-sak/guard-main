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
   * @param {{ fullName?, email?, institution?, faculty?, group? }} data
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
  const getDocumentTypes = () => GET('/api/document-types');

  // ─── Check ────────────────────────────────────────────────────────────────

  /**
   * Check document text for plagiarism (does NOT save to DB).
   * @param {{ content: string, filename: string, category: string, institution?: string }} params
   * @returns {{ ok, data: { success, uniquenessPercent, plagiarismPercent,
   *   mlPlagiarismPercent, mlAiPercent, processingTimeMs,
   *   totalDocumentsChecked, similarDocuments } }}
   */
  const checkDocument = (params) => POST('/api/check', params);

  // ─── Upload ───────────────────────────────────────────────────────────────

  /**
   * Upload & save a document (creates DB record + saves file).
   * Send as FormData with fields:
   *   file (File), title, content, category, status ("draft"|"final"),
   *   author?, institution?, originality_percent?, plagiarism_percent_ml?,
   *   ai_percent_ml?, processing_time_ms?, document_type?
   * @param {FormData} formData
   * @returns {{ ok, data: { success, document: { id, title, filename, wordCount } } }}
   */
  const uploadDocument = (formData) => POST('/api/upload', formData, true);

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
   * Get plagiarism match details for a document.
   * @returns {{ ok, data: { success, matches: [...], aiMatches: [...] } }}
   */
  const getDocumentMatches = (documentId) =>
    GET(`/api/documents/${documentId}/matches`);

  /**
   * Generate (or retrieve cached) PDF report.
   * @returns {{ ok, data: { success, reportUrl, downloadUrl, accessToken } }}
   */
  const generateReport = (documentId) =>
    POST('/api/report', { documentId });

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
  const getAdminDocumentTypes = () => GET('/api/admin/document-types');

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
   * Get system statistics.
   * @param {{ from?, to?, institution?, faculty? }} [params]
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

  /** Run storage cleanup (admin). */
  const runAdminCleanup = () => POST('/api/admin/cleanup', {});

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
    // documents
    getUserDocuments, updateDocumentStatus, updateDocumentTitle,
    deleteUserDocument, getDocumentMatches, generateReport,
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
