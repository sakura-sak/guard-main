/**
 * Локальное файловое хранилище для системы антиплагиата.
 * Файлы uploads и PDF отчёты хранятся на диске в data/,
 * метаданные и контент документов — в PostgreSQL (Prisma).
 */

import fs from "fs"
import path from "path"
import { prisma } from "./prisma"
import { comparisonCategories } from "./comparison-scope"
import { signDocumentAccess } from "./report-access"

// Типы
export type DocumentStatus = "processing" | "draft" | "final" | "archived" | "failed"

export interface StoredDocument {
  id: number
  title: string
  author: string | null
  filename: string | null
  /** File format: "word" | "pdf" */
  documentType?: "word" | "pdf"
  filePath: string | null
  content: string
  wordCount: number
  uploadDate: string
  category: string
  status: DocumentStatus
  userId?: string
  /** Institution id (FK slug, e.g. "bsuir") */
  institutionId?: string
  /** Display name of institution (e.g. "БГУИР") */
  institution?: string
  /** Faculty id (FK slug) */
  facultyId?: string
  /** Display name of faculty */
  faculty?: string
  /** DocumentType FK id */
  documentTypeId?: number
  minhashSignature: number[]
  shingleCount: number
  originalityPercent?: number
  /** Векторный плагиат (Python / Qdrant), % */
  plagiarismPercentMl?: number
  /** Локальный MinHash плагиат, % */
  localPlagiarismPercent?: number
  /** Оценка AI-признаков (Python), % */
  aiPercentMl?: number
  processingTimeMs?: number
  expiresAt?: string
  analysisCompletedAt?: string
  resultViewedAt?: string
}

const DATA_DIR = path.join(process.cwd(), "data")
const REPORTS_DIR = path.join(DATA_DIR, "reports")
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export function computeDraftExpiresAt(uploadDate: string | Date): string {
  const base = uploadDate instanceof Date ? uploadDate.getTime() : new Date(uploadDate).getTime()
  return new Date(base + DRAFT_TTL_MS).toISOString()
}

export function isDraftExpired(doc: StoredDocument): boolean {
  if (doc.status !== "draft") return false
  const exp = doc.expiresAt
    ? new Date(doc.expiresAt).getTime()
    : new Date(doc.uploadDate).getTime() + DRAFT_TTL_MS
  return Date.now() >= exp
}

export function isFileAccessAllowed(doc: StoredDocument): boolean {
  if (doc.status === "archived") return false
  if (doc.status === "draft" && isDraftExpired(doc)) return false
  return Boolean(doc.filePath)
}

function safeCategoryDir(category: string): string {
  const safe = category.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
  return path.join(DATA_DIR, safe)
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function ensureCategoryDirs(category: string) {
  ensureDataDir()
  const dir = safeCategoryDir(category)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const uploads = path.join(dir, "uploads")
  if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true })
}

async function initDb() {
  return prisma
}

const DOC_ORG_INCLUDE = {
  institution: { select: { name: true } },
  faculty: { select: { name: true } },
  user: {
    select: {
      fullName: true,
      institution: { select: { name: true } },
      faculty: { select: { name: true } },
    },
  },
} as const

const DOC_PAYLOAD_INCLUDE = {
  contentPayload: true,
  signaturePayload: true,
} as const

const DOC_FULL_INCLUDE = {
  ...DOC_ORG_INCLUDE,
  ...DOC_PAYLOAD_INCLUDE,
} as const

function parseLegacyMinhashJson(raw: unknown): number[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : []
  } catch {
    return []
  }
}

function mapRowToStoredDocument(row: any): StoredDocument {
  const docType = row.fileFormat === "pdf" || row.fileFormat === "word" ? row.fileFormat : undefined
  const institutionName =
    row.institution?.name ?? row.user?.institution?.name ?? undefined
  const facultyName = row.faculty?.name ?? row.user?.faculty?.name ?? undefined
  const content =
    row.contentPayload?.text ??
    (typeof row.content === "string" ? row.content : "")
  const minhashSignature =
    row.signaturePayload?.minhash ??
    (row.minhashSignatureJson ? parseLegacyMinhashJson(row.minhashSignatureJson) : [])
  const shingleCount =
    row.signaturePayload?.shingleCount ??
    (typeof row.shingleCount === "number" ? row.shingleCount : 0)
  return {
    id: row.id,
    title: row.title,
    author: row.user?.fullName?.trim() || row.userId || null,
    filename: row.filename ?? null,
    documentType: docType,
    filePath: row.filePath ?? null,
    content,
    wordCount: row.wordCount,
    uploadDate: row.uploadDate instanceof Date ? row.uploadDate.toISOString() : row.uploadDate,
    category: row.category,
    status: row.status,
    userId: row.userId ?? undefined,
    institutionId: row.institutionId ?? undefined,
    institution: institutionName,
    facultyId: row.facultyId ?? undefined,
    faculty: facultyName,
    documentTypeId: row.documentTypeId ?? undefined,
    minhashSignature,
    shingleCount,
    originalityPercent: typeof row.originalityPercent === "number" ? row.originalityPercent : undefined,
    plagiarismPercentMl:
      typeof row.plagiarismPercentMl === "number" ? row.plagiarismPercentMl : undefined,
    localPlagiarismPercent:
      typeof row.localPlagiarismPercent === "number" ? row.localPlagiarismPercent : undefined,
    aiPercentMl: typeof row.aiPercentMl === "number" ? row.aiPercentMl : undefined,
    processingTimeMs: typeof row.processingTimeMs === "number" ? row.processingTimeMs : undefined,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt ?? undefined,
    analysisCompletedAt:
      row.analysisCompletedAt instanceof Date
        ? row.analysisCompletedAt.toISOString()
        : row.analysisCompletedAt ?? undefined,
    resultViewedAt:
      row.resultViewedAt instanceof Date
        ? row.resultViewedAt.toISOString()
        : row.resultViewedAt ?? undefined,
  }
}

async function clearDocumentPayload(documentId: number): Promise<void> {
  const db = await initDb()
  await db.documentContent.upsert({
    where: { documentId },
    create: { documentId, text: "" },
    update: { text: "" },
  })
  await db.documentSignature.upsert({
    where: { documentId },
    create: { documentId, minhash: [], shingleCount: 0 },
    update: { minhash: [], shingleCount: 0 },
  })
}

/** Список категорий, для которых есть папка в data/ */
export async function getStorageCategories(): Promise<string[]> {
  const db = await initDb()
  const rows = await db.document.findMany({
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  })
  const cats = rows.map((r) => r.category).filter(Boolean)
  return cats.length > 0 ? cats : ["uncategorized"]
}

// Сохранение файла в папку категории
export function saveFileToDisk(
  fileBuffer: Buffer,
  originalFilename: string,
  category: string,
): string {
  ensureCategoryDirs(category)
  const uploadsDir = path.join(safeCategoryDir(category), "uploads")
  const timestamp = Date.now()
  const ext = path.extname(originalFilename)
  const baseName = path.basename(originalFilename, ext)
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_")
  const newFilename = `${timestamp}_${safeBaseName}${ext}`
  const filePath = path.join(uploadsDir, newFilename)
  fs.writeFileSync(filePath, fileBuffer)
  return newFilename
}

// Добавление документа в PostgreSQL (Prisma). ID — автоинкремент.
export async function addDocumentToDb(
  title: string,
  content: string,
  minhashSignature: number[],
  shingleCount: number,
  filename?: string,
  savedFilename?: string,
  category = "uncategorized",
  status: DocumentStatus = "draft",
  userId?: string,
  institutionId?: string,
  originalityPercent?: number,
  plagiarismPercentMl?: number,
  aiPercentMl?: number,
  processingTimeMs?: number,
  documentType?: "word" | "pdf",
  facultyId?: string,
  documentTypeId?: number,
): Promise<StoredDocument> {
  const normCategory = category.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
  ensureCategoryDirs(normCategory)
  const db = await initDb()
  const relativeFilePath = savedFilename ? `data/${normCategory}/uploads/${savedFilename}` : null
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length
  const uploadDate = new Date()
  const expiresAt = status === "draft" ? new Date(uploadDate.getTime() + DRAFT_TTL_MS) : null

  const created = await db.document.create({
    data: {
      title,
      filename: filename || null,
      fileFormat: documentType ?? null,
      filePath: relativeFilePath,
      wordCount,
      uploadDate,
      category: normCategory,
      status,
      userId: userId ?? null,
      institutionId: institutionId ?? null,
      facultyId: facultyId ?? null,
      documentTypeId: documentTypeId ?? null,
      originalityPercent: typeof originalityPercent === "number" ? Math.round(originalityPercent * 100) / 100 : null,
      plagiarismPercentMl: typeof plagiarismPercentMl === "number" ? plagiarismPercentMl : null,
      aiPercentMl: typeof aiPercentMl === "number" ? aiPercentMl : null,
      processingTimeMs: typeof processingTimeMs === "number" ? Math.max(0, Math.round(processingTimeMs)) : null,
      expiresAt,
      contentPayload: { create: { text: content } },
      signaturePayload: {
        create: {
          minhash: minhashSignature ?? [],
          shingleCount: shingleCount ?? 0,
        },
      },
    },
  })
  const row = await db.document.findUnique({
    where: { id: created.id },
    include: DOC_FULL_INCLUDE,
  })
  return row ? mapRowToStoredDocument(row) : mapRowToStoredDocument(created)
}

async function archiveExpiredDraft(doc: StoredDocument): Promise<void> {
  if (doc.filePath) {
    const fullPath = path.join(process.cwd(), doc.filePath)
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath)
      } catch (err) {
        console.error("Error deleting draft file:", err)
      }
    }
  }
  const db = await initDb()
  await db.document.update({
    where: { id: doc.id },
    data: {
      status: "archived",
      filePath: null,
      filename: doc.filename,
    },
  })
  await clearDocumentPayload(doc.id)
}

async function filterDraftTtlAndCleanup(documents: StoredDocument[]): Promise<StoredDocument[]> {
  const out: StoredDocument[] = []
  for (const doc of documents) {
    if (doc.status === "draft" && isDraftExpired(doc)) {
      await archiveExpiredDraft(doc)
      out.push({ ...doc, status: "archived", filePath: null, content: "", minhashSignature: [], shingleCount: 0 })
    } else {
      out.push(doc)
    }
  }
  return out
}

/**
 * Получение документов из БД. Если передан массив categories — только из этих категорий.
 * Для проверки курсовой/диплома передайте ["coursework", "diploma"].
 */
export async function getAllDocumentsFromDb(
  excludeUserId?: string,
  institutionId?: string,
  categories?: string[],
): Promise<StoredDocument[]> {
  const db = await initDb()

  const where: any = {}

  if (categories && categories.length > 0) {
    where.category = { in: categories }
  }
  if (excludeUserId) {
    where.OR = [{ userId: null }, { userId: { not: excludeUserId } }]
  }
  if (institutionId) {
    where.institutionId = institutionId
  }
  const rows = await db.document.findMany({
    where,
    orderBy: { uploadDate: "desc" },
    include: DOC_ORG_INCLUDE,
  })
  let docs: StoredDocument[] = rows.map(mapRowToStoredDocument)
  if (categories && categories.length > 0) {
    docs = docs.filter((d) => d.status === "final")
  }

  docs = await filterDraftTtlAndCleanup(docs)
  return docs.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
}

/**
 * Пул для сравнения: черновики и финальные работы того же типа (или graduation-пула)
 * и того же УО. Без institutionId сравнение не выполняется (изоляция вузов).
 * excludeUserId — не сравнивать с другими работами того же автора (только чужие).
 */
export async function getDocumentsForComparison(
  category: string,
  institutionId?: string | null,
  excludeDocumentId?: number,
  excludeUserId?: string | null,
): Promise<StoredDocument[]> {
  const instId = institutionId?.trim()
  if (!instId) return []

  const categories = comparisonCategories(category)
  const db = await initDb()

  const excludeUser = excludeUserId?.trim()
  const where: {
    category: { in: string[] }
    status: { in: DocumentStatus[] }
    institutionId: string
    id?: { not: number }
    OR?: Array<{ userId: null } | { userId: { not: string } }>
  } = {
    category: { in: categories },
    status: { in: ["draft", "final"] },
    institutionId: instId,
  }
  if (typeof excludeDocumentId === "number") where.id = { not: excludeDocumentId }
  if (excludeUser) {
    where.OR = [{ userId: null }, { userId: { not: excludeUser } }]
  }

  const rows = await db.document.findMany({
    where,
    orderBy: { uploadDate: "desc" },
    include: DOC_FULL_INCLUDE,
  })
  return filterDraftTtlAndCleanup(rows.map(mapRowToStoredDocument))
}

export async function getUserFinalDocuments(userId: string): Promise<StoredDocument[]> {
  const db = await initDb()
  const rows = await db.document.findMany({
    where: { userId, status: "final" },
    orderBy: { uploadDate: "desc" },
    include: DOC_FULL_INCLUDE,
  })
  return rows.map(mapRowToStoredDocument)
}

export async function getUserDocuments(userId: string): Promise<StoredDocument[]> {
  const db = await initDb()
  const rows = await db.document.findMany({
    where: { userId },
    orderBy: { uploadDate: "desc" },
    include: DOC_FULL_INCLUDE,
  })
  const docs: StoredDocument[] = rows.map(mapRowToStoredDocument)
  return filterDraftTtlAndCleanup(docs)
}

export function getDocumentAuthorLabel(doc: {
  author?: string | null
  userId?: string | null
}): string {
  const name = doc.author?.trim()
  if (name && name !== "—") return name
  const login = doc.userId?.trim()
  if (login) return login
  return "—"
}

export async function getDocumentByIdFromDb(id: number): Promise<StoredDocument | null> {
  const db = await initDb()
  const row = await db.document.findUnique({ where: { id }, include: DOC_FULL_INCLUDE })
  return row ? mapRowToStoredDocument(row) : null
}

export async function deleteDocumentFromDb(id: number): Promise<boolean> {
  const doc = await getDocumentByIdFromDb(id)
  if (!doc) return false

  if (doc.filePath) {
    const fullPath = path.join(process.cwd(), doc.filePath)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }
  const db = await initDb()
  const info = await db.document.deleteMany({ where: { id } })
  return info.count > 0
}

export async function getDocumentCountFromDb(): Promise<number> {
  const db = await initDb()
  return db.document.count()
}

export async function updateDocumentOriginality(documentId: number, originalityPercent: number): Promise<boolean> {
  const db = await initDb()
  const rounded = Math.round(originalityPercent * 100) / 100
  const info = await db.document.updateMany({
    where: { id: documentId },
    data: { originalityPercent: rounded },
  })
  return info.count > 0
}

export async function updateDocumentMlScores(
  documentId: number,
  plagiarismPercentMl: number,
  aiPercentMl: number,
): Promise<boolean> {
  const db = await initDb()
  const p = Math.round(plagiarismPercentMl * 100) / 100
  const a = Math.round(aiPercentMl * 100) / 100
  const info = await db.document.updateMany({
    where: { id: documentId },
    data: { plagiarismPercentMl: p, aiPercentMl: a },
  })
  return info.count > 0
}

export async function updateDocumentCheckScores(
  documentId: number,
  originalityPercent: number,
  plagiarismPercentMl: number,
  aiPercentMl?: number,
): Promise<boolean> {
  const db = await initDb()
  const o = Math.round(originalityPercent * 100) / 100
  const p = Math.round(plagiarismPercentMl * 100) / 100
  const data: {
    originalityPercent: number
    plagiarismPercentMl: number
    aiPercentMl?: number
  } = { originalityPercent: o, plagiarismPercentMl: p }
  if (typeof aiPercentMl === "number" && Number.isFinite(aiPercentMl)) {
    data.aiPercentMl = Math.round(aiPercentMl * 100) / 100
  }
  const info = await db.document.updateMany({ where: { id: documentId }, data })
  return info.count > 0
}

export async function updateDocumentStatus(documentId: number, status: DocumentStatus): Promise<boolean> {
  const db = await initDb()
  const patch: { status: DocumentStatus; expiresAt?: Date | null } = { status }
  if (status === "final" || status === "archived") {
    patch.expiresAt = null
  }
  const info = await db.document.updateMany({ where: { id: documentId }, data: patch })
  return info.count > 0
}

export async function updateDocumentTitle(documentId: number, title: string): Promise<boolean> {
  const db = await initDb()
  const info = await db.document.updateMany({
    where: { id: documentId },
    data: { title: title.trim() },
  })
  return info.count > 0
}

export async function updateDocumentCategory(documentId: number, category: string): Promise<boolean> {
  const normCategory = category.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
  const db = await initDb()
  const info = await db.document.updateMany({
    where: { id: documentId },
    data: { category: normCategory },
  })
  return info.count > 0
}

/** Удаляет с диска файлы архивных работ и текст/minhash из БД; метаданные и проценты остаются для статистики. */
export async function purgeArchivedDocumentStorage(): Promise<{
  purged: number
  filesDeleted: number
  reportsDeleted: number
}> {
  const db = await initDb()
  const rows = await db.document.findMany({
    where: { status: "archived" },
    select: {
      id: true,
      filePath: true,
      contentPayload: { select: { text: true } },
      signaturePayload: { select: { minhash: true } },
    },
  })

  let purged = 0
  let filesDeleted = 0
  let reportsDeleted = 0

  for (const row of rows) {
    const hasFile = Boolean(row.filePath)
    const hasContent = Boolean(row.contentPayload?.text && row.contentPayload.text.length > 0)
    const hasMinhash = Boolean(row.signaturePayload?.minhash && row.signaturePayload.minhash.length > 0)
    if (!hasFile && !hasContent && !hasMinhash) continue

    if (row.filePath) {
      const fullPath = path.join(process.cwd(), row.filePath)
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath)
          filesDeleted++
        } catch (err) {
          console.error(`Error deleting archived upload file ${row.filePath}:`, err)
        }
      }
    }

    if (await deleteReportPdf(row.id)) reportsDeleted++

    await db.document.update({
      where: { id: row.id },
      data: { filePath: null },
    })
    await clearDocumentPayload(row.id)
    purged++
  }

  return { purged, filesDeleted, reportsDeleted }
}

/** @deprecated Use purgeArchivedDocumentStorage — stats rows are kept, only files/text are removed. */
export async function cleanupArchivedRecords(): Promise<number> {
  const result = await purgeArchivedDocumentStorage()
  return result.purged
}

export async function getStorageStats(): Promise<{
  totalDocuments: number
  finalDocuments: number
  totalBytes: number
  byType: Record<string, number>
}> {
  const docs = await getAllDocumentsFromDb()
  const finalDocs = docs.filter((d) => d.status === "final")
  let totalBytes = 0
  const byType: Record<string, number> = {}
  for (const doc of finalDocs) {
    if (doc.filePath) {
      const full = path.join(process.cwd(), doc.filePath)
      if (fs.existsSync(full)) {
        try {
          const st = fs.statSync(full)
          totalBytes += st.size
        } catch {
          /* ignore */
        }
      }
    }
    const t = doc.documentType || "unknown"
    byType[t] = (byType[t] || 0) + 1
  }
  return { totalDocuments: docs.length, finalDocuments: finalDocs.length, totalBytes, byType }
}

// ——— Отчёты (PDF) ———

function ensureReportsDir() {
  ensureDataDir()
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true })
}

function reportRelativePath(documentId: number): string {
  return `data/reports/${documentId}.pdf`
}

/** Upsert metadata row in `reports` when a PDF spravka is stored on disk. */
async function syncReportDbRecord(
  documentId: number,
  generatedById?: string | null,
): Promise<void> {
  const filePath = reportRelativePath(documentId)
  const accessToken = signDocumentAccess("report", documentId)
  const existing = await prisma.report.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  if (existing) {
    await prisma.report.update({
      where: { id: existing.id },
      data: {
        filePath,
        accessToken,
        generatedById: generatedById ?? undefined,
        createdAt: new Date(),
      },
    })
    return
  }
  await prisma.report.create({
    data: {
      documentId,
      filePath,
      accessToken,
      generatedById: generatedById ?? null,
    },
  })
}

export async function saveReportPdf(
  documentId: number,
  pdfBuffer: Buffer,
  options?: { originalityPercent?: number; generatedById?: string | null },
): Promise<boolean> {
  ensureReportsDir()
  const filePath = path.join(REPORTS_DIR, `${documentId}.pdf`)
  try {
    fs.writeFileSync(filePath, pdfBuffer)
    if (options?.originalityPercent !== undefined) {
      await updateDocumentOriginality(documentId, options.originalityPercent)
    }
    await syncReportDbRecord(documentId, options?.generatedById)
    return true
  } catch (err) {
    console.error("Error saving report PDF:", err)
    return false
  }
}

export function getReportPdfPath(documentId: number): string | null {
  const filePath = path.join(REPORTS_DIR, `${documentId}.pdf`)
  return fs.existsSync(filePath) ? filePath : null
}

export function getReportPdfBuffer(documentId: number): Buffer | null {
  const p = getReportPdfPath(documentId)
  if (!p) return null
  try {
    return fs.readFileSync(p)
  } catch {
    return null
  }
}

/** Create `reports` rows for PDFs already on disk (one-time migration). */
export async function backfillReportsFromDisk(): Promise<{ created: number; skipped: number }> {
  ensureReportsDir()
  let created = 0
  let skipped = 0
  const entries = fs.readdirSync(REPORTS_DIR).filter((name) => /^\d+\.pdf$/i.test(name))
  for (const name of entries) {
    const documentId = parseInt(name.replace(/\.pdf$/i, ""), 10)
    if (Number.isNaN(documentId)) continue
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, userId: true },
    })
    if (!doc) {
      skipped++
      continue
    }
    const existing = await prisma.report.findFirst({
      where: { documentId },
      select: { id: true },
    })
    if (existing) {
      skipped++
      continue
    }
    await syncReportDbRecord(documentId, doc.userId)
    created++
  }
  return { created, skipped }
}

export async function deleteReportPdf(documentId: number): Promise<boolean> {
  const p = getReportPdfPath(documentId)
  let ok = true
  if (p) {
    try {
      fs.unlinkSync(p)
    } catch (err) {
      console.error("Error deleting report PDF:", err)
      ok = false
    }
  }
  try {
    await prisma.report.deleteMany({ where: { documentId } })
  } catch (err) {
    console.error("Error deleting report rows:", err)
    ok = false
  }
  return ok
}
