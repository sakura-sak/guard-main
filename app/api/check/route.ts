import { type NextRequest, NextResponse } from "next/server"
import { createShingles, MinHash, compareMinHashSignatures, normalizeContentForCheck } from "@/lib/plagiarism/algorithms"
import { analyzeWithMlService } from "@/lib/analysis-client"
import { getDocumentsForComparison, type StoredDocument } from "@/lib/local-storage"
import { resolveInstitutionId } from "@/lib/directories"
import { logInfo, logError } from "@/lib/logger"
import { requireSessionApi } from "@/lib/require-session-api"

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function roundPercent(n: number): number {
  return Math.round(clampPercent(n) * 100) / 100
}

type SimilarDocumentSummary = {
  id: number
  title: string
  author: string | null
  userId?: string | null
  similarity: number
  category: string
}

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

/**
 * Выбирает базу для локального сравнения:
 * - черновики и финальные документы;
 * - оставляет документы только того же модуля (category);
 * - фильтрует по institution (вуз).
 */
async function getComparisonPoolForModule(category: string | undefined, institutionId?: string | null): Promise<StoredDocument[]> {
  if (!category) return []
  const safeCategory = String(category).replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim()
  if (!safeCategory) return []
  return getDocumentsForComparison(safeCategory, institutionId)
}

function buildLocalSimilarDocuments(
  normalizedContent: string,
  pool: StoredDocument[],
  topK = 5,
): SimilarDocumentSummary[] {
  const queryShingles = createShingles(normalizedContent, 5)
  const querySignature = new MinHash(NUM_HASHES).computeSignature(queryShingles)

  const matches: SimilarDocumentSummary[] = []
  for (const doc of pool) {
    if (!Array.isArray(doc.minhashSignature) || doc.minhashSignature.length !== NUM_HASHES) continue
    const similarity = roundPercent(compareMinHashSignatures(querySignature, doc.minhashSignature) * 100)
    if (similarity < LOCAL_SIMILARITY_THRESHOLD) continue
    matches.push({
      id: doc.id,
      title: doc.title,
      author: doc.author,
      userId: doc.userId ?? null,
      similarity,
      category: doc.category,
    })
  }

  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
}

// POST - Проверка документа на плагиат
export async function POST(request: NextRequest) {
  try {
    const gate = await requireSessionApi(request)
    if (!gate.ok) return gate.response

    const body = await request.json()
    const { content, filename: checkFilename } = body
    const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : "uncategorized"
    const status = body?.status === "final" ? "final" : "draft"
    const institution = typeof body?.institution === "string" ? body.institution : gate.user.institution || "БГУИР"

    if (!content) {
      return NextResponse.json({ success: false, error: "Content is required" }, { status: 400 })
    }

    if (content.length < 50) {
      return NextResponse.json({ success: false, error: "Content must be at least 50 characters" }, { status: 400 })
    }

    const startTime = Date.now()

    // Убираем титульный лист, содержание и приложения перед расчётом оригинальности
    const normalizedContent = normalizeContentForCheck(content)
    const institutionId = await resolveInstitutionId(institution)
    const comparisonPool = await getComparisonPoolForModule(category, institutionId)
    const similarDocuments = buildLocalSimilarDocuments(normalizedContent, comparisonPool, 5)

    const ml = await analyzeWithMlService(normalizedContent, {
      filename: typeof checkFilename === "string" ? checkFilename : undefined,
    })

    const processingTime = Date.now() - startTime

    if (!ml) {
      const url = process.env.ANALYSIS_SERVICE_URL?.trim() || "(not set)"
      return NextResponse.json(
        {
          success: false,
          error:
            `ML analysis service is unavailable at ${url}. ` +
            "Start: docker compose up -d analysis qdrant. " +
            "Wait until http://localhost:8765/health shows ready:true (first start loads models for several minutes on CPU). " +
            "If you use a local API key, set the same value in ANALYSIS_API_KEY (.env) and ANALYSIS_SERVICE_API_KEY (guard-main/.env.local).",
        },
        { status: 503 },
      )
    }

    const localPlagiarismPercent = roundPercent(
      similarDocuments.length > 0 ? similarDocuments[0].similarity : 0,
    )
    const mlPlagiarismPercent = roundPercent(ml.plagiarismPercent)
    const plagiarismPercent = Math.max(localPlagiarismPercent, mlPlagiarismPercent)
    const uniquenessPercent = roundPercent(100 - plagiarismPercent)

    logInfo("Проверка документа завершена", gate.user.username, gate.user.role, "check", {
      uniquenessPercent,
      plagiarismPercent,
      localPlagiarismPercent,
      mlPlagiarismPercent,
      processingTimeMs: processingTime,
      category,
      status,
      mlAnalysisUsed: Boolean(ml),
      localCandidatesChecked: comparisonPool.length,
      originalContentChars: content.length,
      normalizedContentChars: normalizedContent.length,
      topLocalCandidates: similarDocuments.map((doc) => ({
        id: doc.id,
        title: doc.title,
        similarity: doc.similarity,
        category: doc.category,
      })),
    })

    return NextResponse.json({
      success: true,
      processingTimeMs: processingTime,
      plagiarismPercent,
      uniquenessPercent,
      totalDocumentsChecked: comparisonPool.length,
      similarDocuments,
      localPlagiarismPercent,
      mlPlagiarismPercent,
      mlAiPercent: roundPercent(ml.aiPercent),
    })
  } catch (error) {
    logError("Ошибка при проверке документа", error instanceof Error ? error : String(error), undefined, undefined, "check")
    return NextResponse.json({ success: false, error: "Failed to check document" }, { status: 500 })
  }
}
