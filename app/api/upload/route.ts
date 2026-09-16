import { type NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { saveFileToDisk } from "@/lib/local-storage"
import { normalizeContentForCheck } from "@/lib/plagiarism/algorithms"
import { createProcessingDocumentWithJob } from "@/lib/analysis-jobs"
import { computeLocalPlagiarismPercent, computeMinHashSignature } from "@/lib/local-plagiarism"
import { resolveCheckInstitutionScope } from "@/lib/check-institution-scope"
import { resolveFacultyId } from "@/lib/directories"
import { logInfo, logError } from "@/lib/logger"
import { formatApiUploadError } from "@/lib/prisma-error-message"
import { requireSessionOrMoodleApi } from "@/lib/require-moodle-api"
import { getUserByUsername } from "@/lib/user-storage"

function deleteSavedUpload(category: string, savedFilename: string) {
  try {
    const full = path.join(process.cwd(), "data", category, "uploads", savedFilename)
    if (fs.existsSync(full)) fs.unlinkSync(full)
  } catch {
    /* best-effort */
  }
}

/**
 * Upload-first async analysis:
 * save file + MinHash + local score, enqueue AnalysisJob, return 202 immediately.
 * ML is performed by analysis-worker, not in this request.
 */
export async function POST(request: NextRequest) {
  let savedFilename: string | null = null
  let normCategory = "uncategorized"

  try {
    const formData = await request.formData()
    const gate = await requireSessionOrMoodleApi(request, {
      username: formData.get("username") as string | null,
      fullName: formData.get("fullName") as string | null,
      institution: formData.get("institution") as string | null,
    })
    if (!gate.ok) return gate.response

    const file = formData.get("file") as File | null
    const title = formData.get("title") as string
    const category = formData.get("category") as string | null
    const content = formData.get("content") as string
    const userId = gate.user.username
    const dbUser = await getUserByUsername(userId)
    const scope = await resolveCheckInstitutionScope(gate.user, dbUser, {
      institution: (formData.get("institution") as string | null) || gate.user.institution || "",
      institutionId: formData.get("institutionId") as string | null,
    })
    if (!scope.ok) {
      return NextResponse.json({ success: false, error: scope.error }, { status: scope.status })
    }
    const institutionId = scope.institutionId
    const facultyId = institutionId
      ? await resolveFacultyId(institutionId, gate.user.faculty)
      : null
    const documentTypeRaw = formData.get("document_type") as string | null

    if (!file || !title || !content) {
      return NextResponse.json({ success: false, error: "Файл, название и содержимое обязательны" }, { status: 400 })
    }

    const normalizedContent = normalizeContentForCheck(content)
    if (normalizedContent.length < 50) {
      return NextResponse.json(
        { success: false, error: "Документ слишком короткий для проверки (менее 50 символов)" },
        { status: 400 },
      )
    }

    normCategory =
      (category || "uncategorized").replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    savedFilename = saveFileToDisk(fileBuffer, file.name, normCategory)

    let documentType: "word" | "pdf" | undefined
    if (documentTypeRaw === "pdf" || documentTypeRaw === "word") {
      documentType = documentTypeRaw
    } else {
      const ext = file.name.split(".").pop()?.toLowerCase()
      documentType = ext === "pdf" ? "pdf" : ext === "doc" || ext === "docx" ? "word" : undefined
    }

    let shingles: Set<string>
    let signature: number[]
    try {
      const computed = computeMinHashSignature(normalizedContent)
      shingles = computed.shingles
      signature = computed.signature
    } catch (e) {
      if (savedFilename) deleteSavedUpload(normCategory, savedFilename)
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

    const localPlagiarismPercent = await computeLocalPlagiarismPercent(
      normalizedContent,
      signature,
      normCategory,
      institutionId,
      userId,
    )

    const created = await createProcessingDocumentWithJob({
      title: title.trim(),
      content: normalizedContent,
      minhashSignature: signature,
      shingleCount: shingles.size,
      filename: file.name,
      savedFilename,
      category: normCategory,
      userId,
      institutionId,
      facultyId,
      documentType,
      localPlagiarismPercent,
    })

    if (!created.ok) {
      if (savedFilename) deleteSavedUpload(normCategory, savedFilename)
      if (created.conflict) {
        return NextResponse.json({ success: false, error: created.error, code: "ACTIVE_JOB_EXISTS" }, { status: 409 })
      }
      return NextResponse.json({ success: false, error: created.error }, { status: 500 })
    }

    logInfo("Документ поставлен в очередь анализа", userId, undefined, "upload", {
      documentId: created.documentId,
      jobId: created.jobId,
      title: title.trim(),
      category: normCategory,
      status: "processing",
      localPlagiarismPercent,
      institutionId,
      documentTypeId: created.documentTypeId,
    })

    return NextResponse.json(
      {
        success: true,
        status: "processing",
        jobId: created.jobId,
        document: {
          id: created.documentId,
          title: title.trim(),
          filename: file.name,
          wordCount: normalizedContent.split(/\s+/).filter((w) => w.length > 0).length,
          category: normCategory,
          status: "processing",
          localPlagiarismPercent,
        },
        message: "Документ загружен и поставлен в очередь на проверку",
      },
      { status: 202 },
    )
  } catch (error) {
    if (savedFilename) deleteSavedUpload(normCategory, savedFilename)
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
