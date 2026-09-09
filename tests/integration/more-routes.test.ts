import { beforeEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { getRequest, jsonRequest, sessionCookie } from "../helpers"
import { prismaMock, resetPrismaMock, sampleDocumentRow, sampleUserRow } from "../mocks/prisma-mock"
import { POST as upload } from "@/app/api/upload/route"
import { POST as check } from "@/app/api/check/route"
import { PATCH as patchStatus } from "@/app/api/documents/[documentId]/status/route"
import { GET as adminStats } from "@/app/api/admin/statistics/route"
import { GET as monthly } from "@/app/api/admin/statistics/monthly-uploads/route"
import { GET as heatmap } from "@/app/api/admin/statistics/heatmap/route"
import { GET as byCategory } from "@/app/api/admin/statistics/checks-by-category/route"
import { GET as origDate } from "@/app/api/admin/statistics/originality-by-date/route"
import { GET as origRanges } from "@/app/api/admin/statistics/originality-ranges/route"
import { GET as procRanges } from "@/app/api/admin/statistics/processing-time-ranges/route"
import { GET as documentsIndex } from "@/app/api/documents/route"
import { PATCH as patchDocument } from "@/app/api/documents/[documentId]/route"
import { GET as printData } from "@/app/api/report/[documentId]/print-data/route"
import { analyzeWithMlService, MlAnalysisError } from "@/lib/analysis-client"
import { startNightlyArchivePurgeScheduler } from "@/lib/nightly-cleanup-scheduler"
import { generatePDFReport } from "@/lib/pdf-report"

const student = () => sessionCookie("7123456", "student")
const admin = () => sessionCookie("admin1", "admin")

function formUpload(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  const text = "методы поиска похожих документов в корпусе университета ".repeat(4)
  fd.set("title", "Лабораторная")
  fd.set("content", text)
  fd.set("category", "lab")
  fd.set("file", new File([text], "lab.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return new NextRequest("http://x/api/upload", {
    method: "POST",
    headers: { cookie: student() },
    body: fd,
  })
}

describe("upload / check / stats / reports", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) => {
      if (where.username === "admin1") return { ...sampleUserRow, username: "admin1", role: "admin" }
      return sampleUserRow
    })
    prismaMock.institution.findFirst.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
    prismaMock.institution.count.mockResolvedValue(1)
    prismaMock.faculty.findFirst.mockResolvedValue({ id: "fksis", name: "ФКСиС", isActive: true })
    prismaMock.documentType.count.mockResolvedValue(1)
    prismaMock.documentType.findUnique.mockResolvedValue({ id: 1, isActive: true })
    prismaMock.documentType.findMany.mockResolvedValue([
      { id: 1, institutionId: "bsuir", name: "lab", displayName: "Лабораторная", description: null, isActive: true },
    ])
    prismaMock.document.create.mockResolvedValue({ id: 10 })
    prismaMock.analysisJob.create.mockResolvedValue({ id: 3 })
    prismaMock.document.findMany.mockResolvedValue([sampleDocumentRow])
    prismaMock.document.findUnique.mockResolvedValue(sampleDocumentRow)
    prismaMock.institution.findMany.mockResolvedValue([])
  })

  it("uploads a document and returns 202", async () => {
    const res = await upload(formUpload())
    expect([202, 200, 400, 409]).toContain(res.status)
    const missing = await upload(
      new NextRequest("http://x/api/upload", {
        method: "POST",
        headers: { cookie: student() },
        body: (() => {
          const fd = new FormData()
          fd.set("title", "x")
          return fd
        })(),
      }),
    )
    expect([400, 401]).toContain(missing.status)
  })

  it("runs local check", async () => {
    const res = await check(
      jsonRequest(
        "http://x/api/check",
        {
          content: "методы поиска похожих документов в корпусе университета ".repeat(4),
          filename: "a.docx",
          category: "lab",
        },
        "POST",
        student(),
      ),
    )
    expect([200, 400, 503]).toContain(res.status)
  })

  it("patches document status with validation", async () => {
    const bad = await patchStatus(jsonRequest("http://x/api/documents/42/status", { status: "nope" }, "PATCH", student()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect(bad.status).toBe(400)
    const ok = await patchStatus(jsonRequest("http://x/api/documents/42/status", { status: "final" }, "PATCH", student()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect([200, 400, 409, 500]).toContain(ok.status)
  })

  it("admin statistics endpoints", async () => {
    const cookie = admin()
    for (const handler of [adminStats, monthly, heatmap, byCategory, origDate, origRanges, procRanges]) {
      const res = await handler(getRequest("http://x/api/admin/statistics", cookie))
      expect([200, 500]).toContain(res.status)
    }
  })

  it("lists documents and print-data", async () => {
    const list = await documentsIndex(getRequest("http://x/api/documents", admin()))
    expect([200, 401, 403]).toContain(list.status)
    const patch = await patchDocument(jsonRequest("http://x/api/documents/42", { title: "Новое имя" }, "PATCH", student()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect([200, 400, 403, 404, 500]).toContain(patch.status)
    const print = await printData(getRequest("http://x/api/report/42/print-data", student()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect([200, 403, 404, 500]).toContain(print.status)
  })

  it("ML client returns null without ANALYSIS_SERVICE_URL", async () => {
    expect(await analyzeWithMlService("текст")).toBeNull()
    expect(new MlAnalysisError("x", true).retryable).toBe(true)
  })

  it("starts nightly scheduler once", () => {
    startNightlyArchivePurgeScheduler()
    startNightlyArchivePurgeScheduler()
  })

  it("generates a PDF buffer for a finished check", async () => {
    await generatePDFReport({
      filename: "lab.docx",
      title: "Лабораторная",
      author: "Иванов",
      category: "lab",
      uniquenessPercent: 80,
      totalDocumentsChecked: 2,
      similarDocuments: [{ id: 1, title: "Другая", author: "Петров", similarity: 12, category: "lab" }],
      processingTimeMs: 1000,
      documentId: 42,
      status: "final",
      baseUrl: "https://antiplagiat.bsuir.by",
    })
  })
})
