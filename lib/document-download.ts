import fs from "fs"
import path from "path"

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
}

export type DocumentDownloadMeta = {
  ext: string
  mime: string
  downloadName: string
  downloadNameAscii: string
}

/** Resolve original upload filename + MIME from stored metadata. */
export function resolveDocumentDownloadMeta(doc: {
  id: number
  filename?: string | null
  filePath?: string | null
  fileFormat?: string | null
  documentType?: "word" | "pdf"
  title?: string | null
}): DocumentDownloadMeta {
  const fromName = doc.filename ? path.extname(doc.filename).toLowerCase() : ""
  const fromPath = doc.filePath ? path.extname(doc.filePath).toLowerCase() : ""
  let ext = fromName || fromPath
  if (!ext) {
    const fmt = doc.fileFormat ?? doc.documentType
    if (fmt === "pdf") ext = ".pdf"
    else if (fmt === "word") ext = ".docx"
  }
  if (!ext) ext = ".bin"

  const mime = MIME[ext] ?? "application/octet-stream"

  const rawBase = (doc.filename || doc.title || `work-${doc.id}`)
    .replace(/\.(pdf|docx|doc)$/i, "")
    .replace(/[^\w\u0400-\u04FF.\-() ]/g, "_")
    .trim()
  const baseName = rawBase || `work-${doc.id}`

  return {
    ext,
    mime,
    downloadName: `${baseName}${ext}`,
    downloadNameAscii: `work-${doc.id}${ext}`,
  }
}

export function contentDispositionAttachment(filenameAscii: string, filenameUtf8: string): string {
  return `attachment; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filenameUtf8)}`
}

export function readDocumentFileFromDisk(relativePath: string): Buffer | null {
  const fullPath = path.join(process.cwd(), relativePath)
  if (!fs.existsSync(fullPath)) return null
  return fs.readFileSync(fullPath)
}
