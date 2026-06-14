/**
 * Локальное файловое хранилище для системы антиплагиата.
 * Файлы uploads и PDF отчёты хранятся на диске как раньше,
 * а метаданные/контент документов теперь лежат в SQLite.
 */

import fs from "fs"
import path from "path"
import { prisma } from "./prisma"
import { ensureSqliteSeededFromLocalJson } from "./sqlite-seed"

// Типы
export type DocumentStatus = "draft" | "final" | "archived"

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
  /** Faculty id (FK slug) */
  facultyId?: string
  /** DocumentType FK id */
  documentTypeId?: number
  minhashSignature: number[]
  shingleCount: number
  originalityPercent?: number
  /** Векторный плагиат (Python / Qdrant), % */
  plagiarismPercentMl?: number
  /** Оценка AI-признаков (Python), % */
  aiPercentMl?: number
  processingTimeMs?: number
  expiresAt?: string
}

const DATA_DIR = path.join(process.cwd(), "data")
const REPORTS_DIR = path.join(DATA_DIR, "reports")
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const ARCHIVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

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
  await ensureSqliteSeededFromLocalJson()
  return prisma
}

function mapRowToStoredDocument(row: any): StoredDocument {
  const docType = row.fileFormat === "pdf" || row.fileFormat === "word" ? row.fileFormat : undefined
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    filename: row.filename ?? null,
    documentType: docType,
    filePath: row.filePath ?? null,
    content: row.content,
    wordCount: row.wordCount,
    uploadDate: row.uploadDate instanceof Date ? row.uploadDate.toISOString() : row.uploadDate,
    category: row.category,
    status: row.status,
    userId: row.userId ?? undefined,
    institutionId: row.institutionId ?? undefined,
    facultyId: row.facultyId ?? undefined,
    documentTypeId: row.documentTypeId ?? undefined,
    minhashSignature: row.minhashSignatureJson ? JSON.parse(row.minhashSignatureJson) : [],
    shingleCount: row.shingleCount ?? 0,
    originalityPercent: typeof row.originalityPercent === "number" ? row.originalityPercent : undefined,
    plagiarismPercentMl:
      typeof row.plagiarismPercentMl === "number" ? row.plagiarismPercentMl : undefined,
    aiPercentMl: typeof row.aiPercentMl === "number" ? row.aiPercentMl : undefined,
    processingTimeMs: typeof row.processingTimeMs === "number" ? row.processingTimeMs : undefined,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt ?? undefined,
  }
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

// Добавление документа в базу (SQLite). ID — автоинкремент SQLite.
export async function addDocumentToDb(
  title: string,
  content: string,
  minhashSignature: number[],
  shingleCount: number,
  author?: string,
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
      author: author || null,
      filename: filename || null,
      fileFormat: documentType ?? null,
      filePath: relativeFilePath,
      content,
      wordCount,
      uploadDate,
      category: normCategory,
      status,
      userId: userId ?? null,
      institutionId: institutionId ?? null,
      facultyId: facultyId ?? null,
      documentTypeId: documentTypeId ?? null,
      minhashSignatureJson: JSON.stringify(minhashSignature ?? []),
      shingleCount: shingleCount ?? 0,
      originalityPercent: typeof originalityPercent === "number" ? Math.round(originalityPercent * 100) / 100 : null,
      plagiarismPercentMl: typeof plagiarismPercentMl === "number" ? plagiarismPercentMl : null,
      aiPercentMl: typeof aiPercentMl === "number" ? aiPercentMl : null,
      processingTimeMs: typeof processingTimeMs === "number" ? Math.max(0, Math.round(processingTimeMs)) : null,
      expiresAt,
    },
  })
  const id = created.id
  const uploadIso = uploadDate.toISOString()
  return {
    id,
    title,
    author: author || null,
    filename: filename || null,
    documentType,
    filePath: relativeFilePath,
    content,
    wordCount,
    uploadDate: uploadIso,
    category: normCategory,
    status,
    userId,
    institutionId,
    facultyId,
    documentTypeId,
    minhashSignature,
    shingleCount,
    originalityPercent,
    plagiarismPercentMl,
    aiPercentMl,
    processingTimeMs,
    expiresAt: expiresAt?.toISOString(),
  }
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
    data: { status: "archived", filePath: null, filename: doc.filename },
  })
}

async function filterDraftTtlAndCleanup(documents: StoredDocument[]): Promise<StoredDocument[]> {
  const out: StoredDocument[] = []
  for (const doc of documents) {
    if (doc.status === "draft" && isDraftExpired(doc)) {
      await archiveExpiredDraft(doc)
      out.push({ ...doc, status: "archived", filePath: null })
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
  })
  let docs: StoredDocument[] = rows.map(mapRowToStoredDocument)

  // Only final documents participate in comparison pool when categories filter is used
  if (categories && categories.length > 0) {
    docs = docs.filter((d) => d.status === "final")
  }

  docs = await filterDraftTtlAndCleanup(docs)
  return docs.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
}

export async function getUserFinalDocuments(userId: string): Promise<StoredDocument[]> {
  const db = await initDb()
  const rows = await db.document.findMany({
    where: { userId, status: "final" },
    orderBy: { uploadDate: "desc" },
  })
  return rows.map(mapRowToStoredDocument)
}

export async function getUserDocuments(userId: string): Promise<StoredDocument[]> {
  const db = await initDb()
  const rows = await db.document.findMany({
    where: { userId },
    orderBy: { uploadDate: "desc" },
  })
  const docs: StoredDocument[] = rows.map(mapRowToStoredDocument)
  return filterDraftTtlAndCleanup(docs)
}

export async function getDocumentByIdFromDb(id: number): Promise<StoredDocument | null> {
  const db = await initDb()
  const row = await db.document.findUnique({ where: { id } })
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

/** Ночная очистка: удаляет archived записи старше ARCHIVED_RETENTION_MS */
export async function cleanupArchivedRecords(): Promise<number> {
  const db = await initDb()
  const cutoff = new Date(Date.now() - ARCHIVED_RETENTION_MS)
  const old = await db.document.findMany({
    where: { status: "archived", uploadDate: { lt: cutoff } },
    select: { id: true },
  })
  let removed = 0
  for (const row of old) {
    deleteReportPdf(row.id)
    if (await deleteDocumentFromDb(row.id)) removed++
  }
  return removed
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

export function saveReportPdf(
  documentId: number,
  pdfBuffer: Buffer,
  originalityPercent?: number,
): boolean {
  ensureReportsDir()
  const filePath = path.join(REPORTS_DIR, `${documentId}.pdf`)
  try {
    fs.writeFileSync(filePath, pdfBuffer)
    if (originalityPercent !== undefined) {
      void updateDocumentOriginality(documentId, originalityPercent)
    }
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

export function deleteReportPdf(documentId: number): boolean {
  const p = getReportPdfPath(documentId)
  if (!p) return false
  try {
    fs.unlinkSync(p)
    return true
  } catch (err) {
    console.error("Error deleting report PDF:", err)
    return false
  }
}
