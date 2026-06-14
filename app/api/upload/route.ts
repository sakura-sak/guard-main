import { type NextRequest, NextResponse } from "next/server"
import { saveFileToDisk, addDocumentToDb, updateDocumentMlScores } from "@/lib/local-storage"
import { createShingles, MinHash, normalizeContentForCheck } from "@/lib/plagiarism/algorithms"
import { analyzeWithMlService } from "@/lib/analysis-client"
import { resolveFacultyId, resolveInstitutionId } from "@/lib/directories"
import { logInfo, logError } from "@/lib/logger"
import { formatApiUploadError } from "@/lib/prisma-error-message"
import { requireSessionApi } from "@/lib/require-session-api"

const NUM_HASHES = 128

// POST - Загрузка файла и добавление в базу
export async function POST(request: NextRequest) {
  try {
    const gate = await requireSessionApi(request)
    if (!gate.ok) return gate.response

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const title = formData.get("title") as string
    const author = formData.get("author") as string | null
    const category = formData.get("category") as string | null
    const content = formData.get("content") as string
    const status = (formData.get("status") as "draft" | "final") || "draft"
    const userId = gate.user.username
    const institutionName = (formData.get("institution") as string | null) || gate.user.institution || "БГУИР"
    const institutionId = await resolveInstitutionId(institutionName)
    const facultyId = institutionId
      ? await resolveFacultyId(institutionId, gate.user.faculty)
      : null
    const mlPlagRaw = formData.get("plagiarism_percent_ml") as string | null
    const mlAiRaw = formData.get("ai_percent_ml") as string | null
    const originalityRaw = formData.get("originality_percent") as string | null
    const processingTimeMsRaw = formData.get("processing_time_ms") as string | null
    const documentTypeRaw = formData.get("document_type") as string | null

    if (!file || !title || !content) {
      return NextResponse.json({ success: false, error: "Файл, название и содержимое обязательны" }, { status: 400 })
    }

    const normCategory =
      (category || "uncategorized").replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"

    // Сохраняем файл в папку категории (coursework, diploma и т.д.)
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const savedFilename = saveFileToDisk(fileBuffer, file.name, normCategory)

    // Нормализуем содержимое для целей проверки (убираем титульный лист, содержание, приложения)
    const normalizedContent = normalizeContentForCheck(content)

    let plagiarismPercentMl: number | undefined
    let aiPercentMl: number | undefined
    let originalityPercent: number | undefined
    let processingTimeMs: number | undefined
    let documentType: "word" | "pdf" | undefined
    if (mlPlagRaw != null && String(mlPlagRaw).trim() !== "" && mlAiRaw != null && String(mlAiRaw).trim() !== "") {
      const p = Number(mlPlagRaw)
      const a = Number(mlAiRaw)
      if (!Number.isNaN(p) && !Number.isNaN(a)) {
        plagiarismPercentMl = p
        aiPercentMl = a
      }
    }
    if (originalityRaw != null && String(originalityRaw).trim() !== "") {
      const o = Number(originalityRaw)
      if (!Number.isNaN(o) && Number.isFinite(o)) {
        originalityPercent = Math.max(0, Math.min(100, Math.round(o * 100) / 100))
      }
    }
    if (processingTimeMsRaw != null && String(processingTimeMsRaw).trim() !== "") {
      const t = Number(processingTimeMsRaw)
      if (!Number.isNaN(t) && Number.isFinite(t) && t >= 0) {
        processingTimeMs = Math.round(t)
      }
    }
    if (documentTypeRaw === "pdf" || documentTypeRaw === "word") {
      documentType = documentTypeRaw
    } else {
      const ext = file.name.split(".").pop()?.toLowerCase()
      documentType = ext === "pdf" ? "pdf" : ext === "doc" || ext === "docx" ? "word" : undefined
    }

    let shingles
    let signature: number[]
    try {
      shingles = createShingles(normalizedContent, 5)
      const minhash = new MinHash(NUM_HASHES)
      signature = minhash.computeSignature(shingles)
    } catch (e) {
      logError("MinHash при загрузке", e instanceof Error ? e : String(e), undefined, undefined, "upload")
      return NextResponse.json(
        {
          success: false,
          error:
            "Не удалось обработать текст документа (слишком объёмный или некорректный). Попробуйте разбить файл или сократить текст.",
        },
        { status: 400 },
      )
    }

    // Добавляем в базу данных этой категории
    let doc = await addDocumentToDb(
      title,
      normalizedContent,
      signature,
      shingles.size,
      author || undefined,
      file.name,
      savedFilename,
      normCategory,
      status,
      userId || undefined,
      institutionId ?? undefined,
      originalityPercent,
      plagiarismPercentMl,
      aiPercentMl,
      processingTimeMs,
      documentType,
      facultyId ?? undefined,
    )

    // Дозапрос к ML не должен отменять успешно созданную запись в БД
    if (
      (typeof plagiarismPercentMl !== "number" || typeof aiPercentMl !== "number") &&
      normalizedContent.length >= 50
    ) {
      try {
        const ml = await analyzeWithMlService(normalizedContent, { filename: file.name, documentId: doc.id })
        if (ml) {
          await updateDocumentMlScores(doc.id, ml.plagiarismPercent, ml.aiPercent)
          doc = {
            ...doc,
            plagiarismPercentMl: ml.plagiarismPercent,
            aiPercentMl: ml.aiPercent,
          }
        }
      } catch (mlErr) {
        logError(
          "ML-дозапись после загрузки не выполнена (документ уже в БД)",
          mlErr instanceof Error ? mlErr : String(mlErr),
          userId || undefined,
          doc.id,
          "upload",
        )
      }
    }

    logInfo("Документ загружен", userId || undefined, undefined, "upload", {
      documentId: doc.id,
      title: doc.title,
      category: category,
      status: status,
    })

    return NextResponse.json({
      success: true,
      document: {
        id: doc.id,
        title: doc.title,
        filename: doc.filename,
        filePath: doc.filePath,
        wordCount: doc.wordCount,
      },
      message: `Файл сохранен: ${doc.filePath}`,
    })
  } catch (error) {
    logError(
      "Ошибка при загрузке файла",
      error instanceof Error ? error : String(error),
      undefined,
      undefined,
      "upload",
    )
    const msg = formatApiUploadError(error)
    const prismaCode =
      error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined
    return NextResponse.json(
      {
        success: false,
        error: msg,
        ...(prismaCode ? { prismaCode } : {}),
      },
      { status: 500 },
    )
  }
}
