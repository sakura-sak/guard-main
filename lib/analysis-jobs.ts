/**
 * Durable analysis job queue helpers (PostgreSQL-backed).
 * Browser polling only reads state; the analysis-worker claims and completes jobs.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { replaceMlMatchesForDocument, type MlSemanticMatch } from "./ml-matches-storage"
import { resolveDocumentTypeId } from "./document-types"

export type AnalysisJobStatus = "queued" | "processing" | "completed" | "failed"
export type DocumentProcessStatus = "processing" | "draft" | "final" | "archived" | "failed"

export const ACTIVE_JOB_STATUSES: AnalysisJobStatus[] = ["queued", "processing"]
export const MAX_ANALYSIS_ATTEMPTS = 5

const RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
]

export function retryDelayMs(attempt: number): number {
  const idx = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1))
  return RETRY_DELAYS_MS[idx]
}

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

export type CreateProcessingDocumentInput = {
  title: string
  content: string
  minhashSignature: number[]
  shingleCount: number
  filename?: string
  savedFilename?: string
  category: string
  userId: string
  institutionId?: string | null
  facultyId?: string | null
  documentType?: "word" | "pdf"
  localPlagiarismPercent: number
}

export type CreateProcessingDocumentResult =
  | { ok: true; documentId: number; jobId: number; status: "processing"; documentTypeId: number | null }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; error: string }

/**
 * Atomically create Document(status=processing) + AnalysisJob(queued).
 * Unique activeUserId enforces one in-flight analysis per user.
 */
export async function createProcessingDocumentWithJob(
  input: CreateProcessingDocumentInput,
): Promise<CreateProcessingDocumentResult> {
  const normCategory =
    input.category.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
  const relativeFilePath = input.savedFilename
    ? `data/${normCategory}/uploads/${input.savedFilename}`
    : null
  const wordCount = input.content.split(/\s+/).filter((w) => w.length > 0).length
  const uploadDate = new Date()
  const localPlag = roundPercent(input.localPlagiarismPercent)
  const documentTypeId = await resolveDocumentTypeId(input.institutionId, normCategory)

  try {
    const result = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          title: input.title,
          filename: input.filename || null,
          fileFormat: input.documentType ?? null,
          filePath: relativeFilePath,
          wordCount,
          uploadDate,
          category: normCategory,
          status: "processing",
          userId: input.userId,
          institutionId: input.institutionId ?? null,
          facultyId: input.facultyId ?? null,
          documentTypeId,
          localPlagiarismPercent: localPlag,
          contentPayload: { create: { text: input.content } },
          signaturePayload: {
            create: {
              minhash: input.minhashSignature ?? [],
              shingleCount: input.shingleCount ?? 0,
            },
          },
        },
        select: { id: true },
      })

      const job = await tx.analysisJob.create({
        data: {
          documentId: doc.id,
          userId: input.userId,
          institutionId: input.institutionId ?? null,
          status: "queued",
          activeUserId: input.userId,
          attempts: 0,
          availableAt: uploadDate,
        },
        select: { id: true },
      })

      return { documentId: doc.id, jobId: job.id }
    })

    return {
      ok: true,
      documentId: result.documentId,
      jobId: result.jobId,
      status: "processing",
      documentTypeId,
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = Array.isArray(e.meta?.target) ? e.meta?.target.join(",") : String(e.meta?.target ?? "")
      if (target.includes("active_user_id") || target.includes("activeUserId")) {
        return {
          ok: false,
          conflict: true,
          error: "У вас уже есть документ на проверке. Дождитесь завершения текущей обработки.",
        }
      }
    }
    throw e
  }
}

export async function getActiveAnalysisJobForUser(userId: string) {
  return prisma.analysisJob.findFirst({
    where: {
      userId,
      status: { in: ACTIVE_JOB_STATUSES },
    },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          filename: true,
          category: true,
          status: true,
          wordCount: true,
          uploadDate: true,
          localPlagiarismPercent: true,
          originalityPercent: true,
          plagiarismPercentMl: true,
          aiPercentMl: true,
          processingTimeMs: true,
          analysisCompletedAt: true,
          resultViewedAt: true,
          expiresAt: true,
          fileFormat: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function getUnviewedCompletedResultForUser(userId: string) {
  return prisma.document.findFirst({
    where: {
      userId,
      status: { in: ["draft", "failed"] },
      analysisCompletedAt: { not: null },
      resultViewedAt: null,
    },
    orderBy: { analysisCompletedAt: "desc" },
    include: {
      analysisJob: true,
    },
  })
}

export async function markAnalysisResultViewed(documentId: number, userId: string): Promise<boolean> {
  const info = await prisma.document.updateMany({
    where: { id: documentId, userId },
    data: { resultViewedAt: new Date() },
  })
  return info.count > 0
}

export type AnalysisStatePayload = {
  kind: "active" | "unviewed_result" | "none"
  documentId?: number
  jobId?: number
  jobStatus?: AnalysisJobStatus
  documentStatus?: string
  title?: string
  filename?: string
  category?: string
  wordCount?: number
  uploadDate?: string
  localPlagiarismPercent?: number | null
  originalityPercent?: number | null
  plagiarismPercent?: number | null
  plagiarismPercentMl?: number | null
  aiPercentMl?: number | null
  processingTimeMs?: number | null
  analysisCompletedAt?: string | null
  resultViewedAt?: string | null
  expiresAt?: string | null
  lastError?: string | null
  attempts?: number
  queuePosition?: number | null
}

function iso(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : d ?? null
}

export async function buildAnalysisStateForUser(userId: string): Promise<AnalysisStatePayload> {
  const active = await getActiveAnalysisJobForUser(userId)
  if (active) {
    let queuePosition: number | null = null
    if (active.status === "queued") {
      queuePosition = await prisma.analysisJob.count({
        where: {
          status: "queued",
          availableAt: { lte: active.availableAt },
          OR: [
            { createdAt: { lt: active.createdAt } },
            { createdAt: active.createdAt, id: { lte: active.id } },
          ],
        },
      })
    }
    const local = active.document.localPlagiarismPercent ?? 0
    const ml = active.document.plagiarismPercentMl ?? 0
    return {
      kind: "active",
      documentId: active.documentId,
      jobId: active.id,
      jobStatus: active.status as AnalysisJobStatus,
      documentStatus: active.document.status,
      title: active.document.title,
      filename: active.document.filename ?? undefined,
      category: active.document.category,
      wordCount: active.document.wordCount,
      uploadDate: iso(active.document.uploadDate) ?? undefined,
      localPlagiarismPercent: active.document.localPlagiarismPercent,
      originalityPercent: active.document.originalityPercent,
      plagiarismPercent: Math.max(local, ml),
      plagiarismPercentMl: active.document.plagiarismPercentMl,
      aiPercentMl: active.document.aiPercentMl,
      processingTimeMs: active.document.processingTimeMs,
      analysisCompletedAt: iso(active.document.analysisCompletedAt),
      resultViewedAt: iso(active.document.resultViewedAt),
      expiresAt: iso(active.document.expiresAt),
      lastError: active.lastError,
      attempts: active.attempts,
      queuePosition,
    }
  }

  const unviewed = await getUnviewedCompletedResultForUser(userId)
  if (unviewed) {
    if (unviewed.status === "failed") {
      return {
        kind: "active",
        documentId: unviewed.id,
        jobId: unviewed.analysisJob?.id,
        jobStatus: "failed",
        documentStatus: "failed",
        title: unviewed.title,
        filename: unviewed.filename ?? undefined,
        category: unviewed.category,
        wordCount: unviewed.wordCount,
        uploadDate: iso(unviewed.uploadDate) ?? undefined,
        localPlagiarismPercent: unviewed.localPlagiarismPercent,
        originalityPercent: null,
        plagiarismPercent: null,
        plagiarismPercentMl: unviewed.plagiarismPercentMl,
        aiPercentMl: unviewed.aiPercentMl,
        processingTimeMs: unviewed.processingTimeMs,
        analysisCompletedAt: iso(unviewed.analysisCompletedAt),
        resultViewedAt: iso(unviewed.resultViewedAt),
        expiresAt: iso(unviewed.expiresAt),
        lastError: unviewed.analysisJob?.lastError ?? "Проверка завершилась с ошибкой",
        attempts: unviewed.analysisJob?.attempts,
        queuePosition: null,
      }
    }
    const local = unviewed.localPlagiarismPercent ?? 0
    const ml = unviewed.plagiarismPercentMl ?? 0
    const plag = Math.max(local, ml)
    return {
      kind: "unviewed_result",
      documentId: unviewed.id,
      jobId: unviewed.analysisJob?.id,
      jobStatus: (unviewed.analysisJob?.status as AnalysisJobStatus) || "completed",
      documentStatus: unviewed.status,
      title: unviewed.title,
      filename: unviewed.filename ?? undefined,
      category: unviewed.category,
      wordCount: unviewed.wordCount,
      uploadDate: iso(unviewed.uploadDate) ?? undefined,
      localPlagiarismPercent: unviewed.localPlagiarismPercent,
      originalityPercent: unviewed.originalityPercent ?? roundPercent(100 - plag),
      plagiarismPercent: plag,
      plagiarismPercentMl: unviewed.plagiarismPercentMl,
      aiPercentMl: unviewed.aiPercentMl,
      processingTimeMs: unviewed.processingTimeMs,
      analysisCompletedAt: iso(unviewed.analysisCompletedAt),
      resultViewedAt: iso(unviewed.resultViewedAt),
      expiresAt: iso(unviewed.expiresAt),
      lastError: unviewed.analysisJob?.lastError ?? null,
      attempts: unviewed.analysisJob?.attempts,
      queuePosition: null,
    }
  }

  return { kind: "none" }
}

export async function getDocumentAnalysisState(documentId: number, userId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, userId },
    include: { analysisJob: true },
  })
  if (!doc) return null
  const local = doc.localPlagiarismPercent ?? 0
  const ml = doc.plagiarismPercentMl ?? 0
  const plag = Math.max(local, ml)
  return {
    documentId: doc.id,
    jobId: doc.analysisJob?.id ?? null,
    jobStatus: (doc.analysisJob?.status as AnalysisJobStatus | undefined) ?? null,
    documentStatus: doc.status,
    title: doc.title,
    filename: doc.filename,
    category: doc.category,
    wordCount: doc.wordCount,
    uploadDate: iso(doc.uploadDate),
    localPlagiarismPercent: doc.localPlagiarismPercent,
    originalityPercent: doc.originalityPercent ?? (doc.status === "draft" || doc.status === "final" ? roundPercent(100 - plag) : null),
    plagiarismPercent: doc.status === "processing" || doc.status === "failed" ? (ml > 0 || local > 0 ? plag : null) : plag,
    plagiarismPercentMl: doc.plagiarismPercentMl,
    aiPercentMl: doc.aiPercentMl,
    processingTimeMs: doc.processingTimeMs,
    analysisCompletedAt: iso(doc.analysisCompletedAt),
    resultViewedAt: iso(doc.resultViewedAt),
    expiresAt: iso(doc.expiresAt),
    lastError: doc.analysisJob?.lastError ?? null,
    attempts: doc.analysisJob?.attempts ?? 0,
  }
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
/** Renewed on every ML poll so long diploma jobs are not requeued mid-flight. */
const LEASE_MS = 60 * 60 * 1000

export type ClaimedAnalysisJob = {
  id: number
  documentId: number
  userId: string
  institutionId: string | null
  category: string
  attempts: number
  mlJobId: string | null
  content: string
  filename: string | null
  localPlagiarismPercent: number
}

/**
 * Fair claim: among available queued (or expired-lease) jobs, pick the oldest
 * job from the next university in round-robin order.
 */
export async function claimNextAnalysisJob(workerId: string): Promise<ClaimedAnalysisJob | null> {
  const now = new Date()

  // Recover expired leases (keep mlJobId — resume poll, do not resubmit blindly)
  await prisma.analysisJob.updateMany({
    where: {
      status: "processing",
      leaseUntil: { lt: now },
    },
    data: {
      status: "queued",
      leaseUntil: null,
      availableAt: now,
      lastError: `Lease expired; requeued by ${workerId}`,
    },
  })

  const candidates = await prisma.analysisJob.findMany({
    where: {
      status: "queued",
      availableAt: { lte: now },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      documentId: true,
      userId: true,
      institutionId: true,
      attempts: true,
      mlJobId: true,
      createdAt: true,
    },
  })
  if (!candidates.length) return null

  const byUni = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const key = c.institutionId?.trim() || "default"
    const list = byUni.get(key) || []
    list.push(c)
    byUni.set(key, list)
  }
  const universities = [...byUni.keys()].sort()
  // Deterministic RR offset based on time bucket so workers rotate fairly
  const rrOffset = Math.floor(Date.now() / 1000) % universities.length
  let chosen: (typeof candidates)[0] | null = null
  for (let step = 0; step < universities.length; step++) {
    const uni = universities[(rrOffset + step) % universities.length]
    const list = byUni.get(uni)
    if (list?.length) {
      chosen = list[0]
      break
    }
  }
  if (!chosen) return null

  const leaseUntil = new Date(now.getTime() + LEASE_MS)
  const claimed = await prisma.analysisJob.updateMany({
    where: {
      id: chosen.id,
      status: "queued",
      availableAt: { lte: now },
    },
    data: {
      status: "processing",
      startedAt: chosen.mlJobId ? undefined : now,
      leaseUntil,
      // attempts bump only when a brand-new ML submit is needed (see attachMlJobId)
      lastError: null,
    },
  })
  if (claimed.count === 0) return null

  const job = await prisma.analysisJob.findUnique({
    where: { id: chosen.id },
    include: {
      document: {
        include: { contentPayload: true },
      },
    },
  })
  if (!job?.document) return null

  return {
    id: job.id,
    documentId: job.documentId,
    userId: job.userId,
    institutionId: job.institutionId,
    category: job.document.category,
    attempts: job.attempts,
    mlJobId: job.mlJobId,
    content: job.document.contentPayload?.text ?? "",
    filename: job.document.filename,
    localPlagiarismPercent: job.document.localPlagiarismPercent ?? 0,
  }
}

export async function attachMlJobId(jobId: number, mlJobId: string): Promise<void> {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: {
      mlJobId,
      attempts: { increment: 1 },
      startedAt: new Date(),
      leaseUntil: new Date(Date.now() + LEASE_MS),
      lastError: null,
    },
  })
}

export async function clearMlJobId(jobId: number, reason: string): Promise<void> {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: {
      mlJobId: null,
      lastError: reason.slice(0, 2000),
    },
  })
}

export async function renewAnalysisJobLease(jobId: number): Promise<void> {
  await prisma.analysisJob.updateMany({
    where: { id: jobId, status: "processing" },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  })
}

export async function completeAnalysisJob(params: {
  jobId: number
  documentId: number
  plagiarismPercentMl: number
  aiPercentMl: number
  localPlagiarismPercent: number
  processingTimeMs: number
  semanticMatches: MlSemanticMatch[]
}): Promise<void> {
  const mlPlag = roundPercent(params.plagiarismPercentMl)
  const ai = roundPercent(params.aiPercentMl)
  const local = roundPercent(params.localPlagiarismPercent)
  const plag = Math.max(local, mlPlag)
  const originality = roundPercent(100 - plag)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS)

  await prisma.$transaction(async (tx) => {
    await tx.analysisJob.update({
      where: { id: params.jobId },
      data: {
        status: "completed",
        activeUserId: null,
        leaseUntil: null,
        completedAt: now,
        lastError: null,
      },
    })
    await tx.document.update({
      where: { id: params.documentId },
      data: {
        status: "draft",
        plagiarismPercentMl: mlPlag,
        aiPercentMl: ai,
        localPlagiarismPercent: local,
        originalityPercent: originality,
        processingTimeMs: Math.max(0, Math.round(params.processingTimeMs)),
        analysisCompletedAt: now,
        resultViewedAt: null,
        expiresAt,
      },
    })
  })

  await replaceMlMatchesForDocument(params.documentId, params.semanticMatches)
}

export async function failOrRetryAnalysisJob(params: {
  jobId: number
  documentId: number
  attempts: number
  error: string
}): Promise<"retry" | "failed"> {
  const now = new Date()
  const err = params.error.slice(0, 2000)

  if (params.attempts >= MAX_ANALYSIS_ATTEMPTS) {
    await prisma.$transaction(async (tx) => {
      await tx.analysisJob.update({
        where: { id: params.jobId },
        data: {
          status: "failed",
          activeUserId: null,
          leaseUntil: null,
          completedAt: now,
          lastError: err,
        },
      })
      await tx.document.update({
        where: { id: params.documentId },
        data: {
          status: "failed",
          analysisCompletedAt: now,
        },
      })
    })
    return "failed"
  }

  const delay = retryDelayMs(params.attempts)
  await prisma.analysisJob.update({
    where: { id: params.jobId },
    data: {
      status: "queued",
      leaseUntil: null,
      availableAt: new Date(now.getTime() + delay),
      lastError: err,
    },
  })
  return "retry"
}

export async function getAnalysisQueueStats() {
  const [queued, processing, failed24h, oldestQueued] = await Promise.all([
    prisma.analysisJob.count({ where: { status: "queued" } }),
    prisma.analysisJob.count({ where: { status: "processing" } }),
    prisma.analysisJob.count({
      where: {
        status: "failed",
        completedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.analysisJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, institutionId: true },
    }),
  ])
  return {
    queued,
    processing,
    failed24h,
    oldestQueuedAgeSec: oldestQueued
      ? Math.round((Date.now() - oldestQueued.createdAt.getTime()) / 1000)
      : 0,
    oldestQueuedInstitutionId: oldestQueued?.institutionId ?? null,
  }
}

export async function purgeTerminalAnalysisJobs(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
  const result = await prisma.analysisJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      completedAt: { lt: cutoff },
    },
  })
  return result.count
}
