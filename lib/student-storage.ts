import type { ParsedFile } from "./file-parser"

export type CheckHistoryStatus = "draft" | "final"

export interface CheckHistoryItem {
  id: string
  timestamp: number
  filename: string
  fileType: string
  wordCount: number
  uniquenessPercent: number
  totalDocumentsChecked: number
  similarCount: number
  processingTimeMs: number
  status: CheckHistoryStatus
  // ID сохранённого в базе документа (для финальных версий)
  documentId?: number
  // Снимок результата проверки для повторного просмотра
  resultSnapshot?: any
}

const STORAGE_KEY = "student_check_history"
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000 // 24 часа

export function saveCheckResult(parsedFile: ParsedFile, result: any): void {
  if (typeof window === "undefined") return

  const history = getCheckHistory()
  const status: CheckHistoryStatus = result.status === "final" || result.documentId ? "final" : "draft"

  const item: CheckHistoryItem = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    filename: parsedFile.filename,
    fileType: parsedFile.fileType,
    wordCount: parsedFile.wordCount,
    uniquenessPercent: result.uniquenessPercent,
    totalDocumentsChecked: result.totalDocumentsChecked,
    similarCount: result.similarDocuments.filter((d: any) => d.similarity > 10).length,
    processingTimeMs: result.processingTimeMs,
    status,
    documentId: typeof result.documentId === "number" ? result.documentId : undefined,
    resultSnapshot: result,
  }

  history.unshift(item)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50))) // Keep last 50
}

export function getCheckHistory(): CheckHistoryItem[] {
  if (typeof window === "undefined") return []
  const data = localStorage.getItem(STORAGE_KEY)
  if (!data) return []

  const raw: CheckHistoryItem[] = JSON.parse(data)
  const now = Date.now()

  const normalized = raw.map((item) => ({
    ...item,
    status: (item as any).status ?? "draft",
  }))

  const filtered = normalized.filter((item) => {
    if (item.status === "final") return true
    return now - item.timestamp < DRAFT_TTL_MS
  })

  if (filtered.length !== raw.length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  }

  return filtered
}

export function deleteCheckHistoryItem(id: string): void {
  if (typeof window === "undefined") return
  const history = getCheckHistory().filter((item) => item.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

export function clearCheckHistory(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(STORAGE_KEY)
}
