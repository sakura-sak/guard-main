import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb, getDocumentsForComparison } from "@/lib/local-storage"
import {
  compareMinHashSignatures,
  findMatchingFragments,
  normalizeContentForCheck,
} from "@/lib/plagiarism/algorithms"
import { logInfo } from "@/lib/logger"
import { requireSessionApi } from "@/lib/require-session-api"

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  const { documentId } = await params
  const id = parseInt(documentId, 10)
  if (Number.isNaN(id)) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  const doc = await getDocumentByIdFromDb(id)
  if (!doc) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  const isOwner = doc.userId === gate.user.username
  const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
  }

  const hasValidSignature = Array.isArray(doc.minhashSignature) && doc.minhashSignature.length === NUM_HASHES
  const pool = hasValidSignature ? await getDocumentsForComparison(doc.category, doc.institutionId, id) : []
  const normalizedDocContent = normalizeContentForCheck(doc.content)
  const similarDocs = pool
    .filter((other) => Array.isArray(other.minhashSignature) && other.minhashSignature.length === NUM_HASHES)
    .map((other) => ({
      id: other.id,
      title: other.title,
      author: other.author,
      userId: other.userId ?? null,
      similarity: roundPercent(compareMinHashSignatures(doc.minhashSignature, other.minhashSignature) * 100),
      category: other.category,
      content: other.content,
    }))
    .filter((other) => other.similarity >= LOCAL_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10)

  const fragments: Array<{
    text: string
    sourceTitle: string
    sourceId: number
    similarity: number
    type: "borrow" | "ai"
  }> = []

  const borrowMatches = []
  let candidatesWithoutFragments = 0
  for (const sim of similarDocs.slice(0, 5)) {
    const matches = findMatchingFragments(normalizedDocContent, normalizeContentForCheck(sim.content), 5)
    const best = matches[0]
    if (!best) {
      candidatesWithoutFragments++
      continue
    }
    const row = {
      sourceTitle: sim.title,
      sourceId: sim.id,
      sourceAuthor: sim.author,
      similarity: sim.similarity,
      quote: best.text,
      wordCount: best.wordCount,
      type: "borrow" as const,
    }
    borrowMatches.push(row)
    for (const m of matches.slice(0, 3)) {
      fragments.push({
        text: m.text,
        sourceTitle: sim.title,
        sourceId: sim.id,
        similarity: sim.similarity,
        type: "borrow",
      })
    }
  }

  // Fallback: MinHash нашёл похожие работы, но точные непрерывные фрагменты не выделились
  // (рассеянные совпадения коротких фраз). Чтобы модалка и печатный отчёт совпадали с QR-отчётом,
  // показываем источники на уровне документа.
  if (borrowMatches.length === 0 && similarDocs.length > 0) {
    for (const sim of similarDocs.slice(0, 5)) {
      borrowMatches.push({
        sourceTitle: sim.title,
        sourceId: sim.id,
        sourceAuthor: sim.author,
        similarity: sim.similarity,
        quote: `Структурное сходство с работой «${sim.title}» (≈${Math.round(sim.similarity)}%). Точные непрерывные фрагменты не выделены.`,
        wordCount: 0,
        type: "borrow" as const,
      })
    }
  }

  const aiPercent = doc.aiPercentMl ?? 0
  const aiMatches = []
  if (aiPercent > 0 && doc.content.length > 200) {
    const chunk = doc.content.slice(0, 500)
    const aiRow = {
      text: chunk,
      sourceTitle: "AI-детектор",
      sourceId: 0,
      similarity: aiPercent,
      confidence: aiPercent >= 50 ? "высокая" : aiPercent >= 20 ? "средняя" : "низкая",
      quote: chunk,
      type: "ai" as const,
    }
    aiMatches.push(aiRow)
    fragments.push(aiRow)
  }

  const localPlagiarismPercent = roundPercent(similarDocs[0]?.similarity ?? 0)
  const mlPlagiarismPercent = roundPercent(doc.plagiarismPercentMl ?? 0)
  const plagiarismPercent = Math.max(localPlagiarismPercent, mlPlagiarismPercent)

  logInfo("Заимствования рассчитаны для документа", gate.user.username, gate.user.role, "document_matches", {
    documentId: id,
    category: doc.category,
    institutionId: doc.institutionId ?? null,
    poolSize: pool.length,
    candidateCount: similarDocs.length,
    borrowMatchCount: borrowMatches.length,
    fragmentCount: fragments.filter((f) => f.type === "borrow").length,
    candidatesWithoutFragments,
    localPlagiarismPercent,
    mlPlagiarismPercent,
    plagiarismPercent,
    topCandidates: similarDocs.slice(0, 5).map(({ content, ...sim }) => sim),
  })

  return NextResponse.json({
    success: true,
    similarDocuments: similarDocs.map(({ content, ...sim }) => sim),
    fragments,
    borrowMatches,
    aiMatches,
    aiPercent: doc.aiPercentMl,
    localPlagiarismPercent,
    mlPlagiarismPercent,
    plagiarismPercent,
    originalityPercent: doc.originalityPercent ?? roundPercent(100 - plagiarismPercent),
  })
}
