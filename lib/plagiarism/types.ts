// Типы для системы антиплагиата

export interface Document {
  id: string
  title: string
  author: string
  content: string
  uploadedAt: Date
  category: "diploma" | "coursework" | "essay" | "article" | "other"
  // Цифровой отпечаток документа
  shingles?: number[]
  minhashSignature?: number[]
}

export interface PlagiarismMatch {
  documentId: string
  documentTitle: string
  documentAuthor: string
  similarity: number // 0-1 (процент схожести)
  matchedFragments: MatchedFragment[]
}

export interface MatchedFragment {
  sourceText: string
  matchedText: string
  position: number
}

export interface PlagiarismReport {
  uniqueness: number // процент уникальности
  totalMatches: number
  topMatches: PlagiarismMatch[]
  analyzedAt: Date
  processingTime: number // в миллисекундах
}

export interface DocumentUpload {
  title: string
  author: string
  content: string
  category: Document["category"]
}
