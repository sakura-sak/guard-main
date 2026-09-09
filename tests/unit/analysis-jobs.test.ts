import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock, sampleDocumentRow } from "../mocks/prisma-mock"
import {
  ACTIVE_JOB_STATUSES,
  attachMlJobId,
  buildAnalysisStateForUser,
  completeAnalysisJob,
  createProcessingDocumentWithJob,
  failOrRetryAnalysisJob,
  getAnalysisQueueStats,
  getDocumentAnalysisState,
  markAnalysisResultViewed,
  purgeTerminalAnalysisJobs,
  renewAnalysisJobLease,
  retryDelayMs,
} from "@/lib/analysis-jobs"

describe("analysis-jobs", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.documentType.count.mockResolvedValue(1)
    prismaMock.documentType.findUnique.mockResolvedValue({ id: 1, isActive: true })
    prismaMock.institution.findMany.mockResolvedValue([])
  })

  it("grows retry delay and lists active statuses", () => {
    expect(ACTIVE_JOB_STATUSES).toContain("queued")
    expect(retryDelayMs(1)).toBe(30_000)
    expect(retryDelayMs(99)).toBe(30 * 60_000)
  })

  it("creates a processing document inside a transaction", async () => {
    prismaMock.document.create.mockResolvedValue({ id: 10 })
    prismaMock.analysisJob.create.mockResolvedValue({ id: 3 })
    const result = await createProcessingDocumentWithJob({
      title: "Работа",
      content: "слово ".repeat(60),
      minhashSignature: Array.from({ length: 128 }, (_, i) => i),
      shingleCount: 10,
      category: "lab",
      userId: "7123456",
      institutionId: "bsuir",
      localPlagiarismPercent: 11.1,
      savedFilename: "lab.docx",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.documentId).toBe(10)
      expect(result.status).toBe("processing")
    }
  })

  it("reads analysis state for owner", async () => {
    prismaMock.document.findFirst.mockResolvedValue({
      ...sampleDocumentRow,
      analysisJob: { id: 7, status: "completed", lastError: null, attempts: 1 },
    })
    const state = await getDocumentAnalysisState(42, "7123456")
    expect(state?.originalityPercent).toBe(81.7)
    expect(state?.plagiarismPercent).toBe(18.3)
  })

  it("builds empty / active analysis state for a user", async () => {
    prismaMock.analysisJob.findFirst.mockResolvedValue(null)
    prismaMock.document.findFirst.mockResolvedValue(null)
    expect(await buildAnalysisStateForUser("nobody")).toEqual({ kind: "none" })

    prismaMock.analysisJob.findFirst.mockResolvedValue({
      id: 1,
      documentId: 42,
      status: "queued",
      lastError: null,
      attempts: 0,
      createdAt: new Date(),
      availableAt: new Date(),
      document: sampleDocumentRow,
    })
    prismaMock.analysisJob.count.mockResolvedValue(2)
    const active = await buildAnalysisStateForUser("7123456")
    expect(active.kind).toBe("active")
  })

  it("completes, fails, renews and purges jobs", async () => {
    await completeAnalysisJob({
      jobId: 1,
      documentId: 42,
      plagiarismPercentMl: 20,
      aiPercentMl: 5,
      localPlagiarismPercent: 10,
      processingTimeMs: 1000,
      semanticMatches: [],
    })
    expect(await failOrRetryAnalysisJob({ jobId: 1, documentId: 42, error: "boom", attempts: 5 })).toBe("failed")
    expect(await failOrRetryAnalysisJob({ jobId: 1, documentId: 42, error: "boom", attempts: 1 })).toBe("retry")
    await renewAnalysisJobLease(1)
    await attachMlJobId(1, "ml-1")
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 })
    expect(await markAnalysisResultViewed(42, "7123456")).toBe(true)
    expect(await purgeTerminalAnalysisJobs(7)).toBe(1)
    const stats = await getAnalysisQueueStats()
    expect(stats).toHaveProperty("queued")
  })
})
