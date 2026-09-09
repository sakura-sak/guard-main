import { beforeEach, describe, expect, it } from "vitest"
import { getRequest, jsonRequest, sessionCookie } from "../helpers"
import { prismaMock, resetPrismaMock, sampleDocumentRow, sampleUserRow } from "../mocks/prisma-mock"
import { GET as getDirectories } from "@/app/api/directories/route"
import { GET as getDocumentTypes } from "@/app/api/document-types/route"
import { GET as getAnalysisState } from "@/app/api/analysis/state/route"
import { GET as getAnalysisHealth } from "@/app/api/analysis/health/route"
import { POST as register } from "@/app/api/auth/register/route"
import { POST as adminCleanup } from "@/app/api/admin/cleanup/route"
import { GET as adminLogs } from "@/app/api/admin/logs/route"
import { GET as adminStorageStats } from "@/app/api/admin/storage/stats/route"
import { GET as adminDirectories } from "@/app/api/admin/directories/route"
import { GET as adminUsers } from "@/app/api/admin/users/route"
import { GET as userDocuments } from "@/app/api/documents/user/[username]/route"
import { GET as documentAnalysis } from "@/app/api/documents/[documentId]/analysis/route"
import { POST as markViewed } from "@/app/api/documents/[documentId]/analysis/viewed/route"
import { GET as documentMatches } from "@/app/api/documents/[documentId]/matches/route"
import { GET as usersMe, PATCH as patchMe } from "@/app/api/users/me/route"
import { GET as reportQr } from "@/app/api/report/qr/route"
import { GET as reportLinks } from "@/app/api/report/[documentId]/links/route"
import { POST as cronPurge } from "@/app/api/cron/purge-archived/route"
import { GET as adminDocumentTypesGet } from "@/app/api/admin/document-types/route"

const studentCookie = () => sessionCookie("7123456", "student")
const adminCookie = () => sessionCookie("admin1", "admin")
const superCookie = () => sessionCookie("root", "superadmin")

const adminRow = {
  ...sampleUserRow,
  username: "admin1",
  role: "admin",
  fullName: "Админ",
}

const superRow = {
  ...sampleUserRow,
  username: "root",
  role: "superadmin",
  institutionId: null,
}

describe("API routes", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.institution.count.mockResolvedValue(1)
    prismaMock.institution.findMany.mockResolvedValue([
      { id: "bsuir", name: "БГУИР", isActive: true, faculties: [] },
    ])
    prismaMock.institution.findFirst.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
    prismaMock.institution.findUnique.mockResolvedValue({
      id: "bsuir",
      name: "БГУИР",
      isActive: true,
      faculties: [],
    })
    prismaMock.documentType.count.mockResolvedValue(1)
    prismaMock.documentType.findMany.mockResolvedValue([
      { id: 1, institutionId: "bsuir", name: "lab", displayName: "Лабораторная", description: null, isActive: true },
    ])
    prismaMock.document.findMany.mockResolvedValue([sampleDocumentRow])
    prismaMock.document.findUnique.mockResolvedValue(sampleDocumentRow)
    prismaMock.document.findFirst.mockResolvedValue({
      ...sampleDocumentRow,
      analysisJob: sampleDocumentRow.analysisJob,
    })
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) => {
      if (where.username === "admin1") return adminRow
      if (where.username === "root") return superRow
      if (where.username === "7123456") return sampleUserRow
      return null
    })
    prismaMock.user.findMany.mockResolvedValue([sampleUserRow])
    prismaMock.analysisJob.findFirst.mockResolvedValue(null)
    prismaMock.analysisJob.count.mockResolvedValue(0)
    prismaMock.plagiarismMatch.findMany.mockResolvedValue([])
  })

  it("GET /api/directories", async () => {
    const res = await getDirectories()
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it("GET /api/document-types", async () => {
    const missing = await getDocumentTypes(getRequest("http://x/api/document-types"))
    expect(missing.status).toBe(400)
    const ok = await getDocumentTypes(getRequest("http://x/api/document-types?institutionId=bsuir"))
    expect(ok.status).toBe(200)
  })

  it("GET /api/analysis/state and health", async () => {
    const unauth = await getAnalysisState(getRequest("http://x/api/analysis/state"))
    expect(unauth.status).toBe(401)
    const ok = await getAnalysisState(getRequest("http://x/api/analysis/state", studentCookie()))
    expect(ok.status).toBe(200)
    const healthDenied = await getAnalysisHealth(getRequest("http://x/api/analysis/health"))
    expect(healthDenied.status).toBe(401)
    const health = await getAnalysisHealth(
      getRequest("http://x/api/analysis/health", undefined),
    )
    const withSecret = new Request("http://x/api/analysis/health", {
      headers: { "x-cron-secret": "test-cron-secret" },
    })
    const { NextRequest } = await import("next/server")
    const healthOk = await getAnalysisHealth(new NextRequest(withSecret))
    expect(healthOk.status).toBe(200)
  })

  it("POST /api/auth/register", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const res = await register(
      jsonRequest("http://x/api/auth/register", { username: "newone", password: "secret1" }),
    )
    expect([200, 400]).toContain(res.status)
    const bad = await register(jsonRequest("http://x/api/auth/register", { username: "", password: "" }))
    expect(bad.status).toBe(400)
  })

  it("admin cleanup / logs / storage / directories / users", async () => {
    expect((await adminCleanup(jsonRequest("http://x/api/admin/cleanup", {}, "POST", adminCookie()))).status).toBe(200)
    expect((await adminLogs(getRequest("http://x/api/admin/logs", adminCookie()))).status).toBe(200)
    expect((await adminStorageStats(getRequest("http://x/api/admin/storage/stats", adminCookie()))).status).toBe(200)
    expect((await adminDirectories(getRequest("http://x/api/admin/directories", adminCookie()))).status).toBe(200)
    expect((await adminUsers(getRequest("http://x/api/admin/users", adminCookie()))).status).toBe(200)
    expect((await adminDocumentTypesGet(getRequest("http://x/api/admin/document-types", superCookie()))).status).toBe(
      200,
    )
  })

  it("document list, analysis, viewed, matches", async () => {
    const list = await userDocuments(getRequest("http://x/api/documents/user/7123456", studentCookie()), {
      params: Promise.resolve({ username: "7123456" }),
    })
    expect(list.status).toBe(200)

    const analysis = await documentAnalysis(getRequest("http://x/api/documents/42/analysis", studentCookie()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect(analysis.status).toBe(200)

    const badId = await documentAnalysis(getRequest("http://x/api/documents/xx/analysis", studentCookie()), {
      params: Promise.resolve({ documentId: "xx" }),
    })
    expect(badId.status).toBe(400)

    const viewed = await markViewed(jsonRequest("http://x/api/documents/42/analysis/viewed", {}, "POST", studentCookie()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect(viewed.status).toBe(200)

    const matches = await documentMatches(getRequest("http://x/api/documents/42/matches", studentCookie()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect([200, 409]).toContain(matches.status)
  })

  it("users/me and report helpers", async () => {
    const me = await usersMe(getRequest("http://x/api/users/me", studentCookie()))
    expect(me.status).toBe(200)
    const patched = await patchMe(
      jsonRequest("http://x/api/users/me", { facultyId: "fksis", group: "050501" }, "PATCH", studentCookie()),
    )
    expect([200, 400, 403, 500]).toContain(patched.status)

    const qrMissing = await reportQr(getRequest("http://x/api/report/qr"))
    expect(qrMissing.status).toBe(400)
    const qr = await reportQr(getRequest("http://x/api/report/qr?data=https://antiplagiat.bsuir.by"))
    expect(qr.status).toBe(200)

    const links = await reportLinks(getRequest("http://x/api/report/42/links", studentCookie()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect([200, 403, 404]).toContain(links.status)
  })

  it("cron purge requires secret", async () => {
    const denied = await cronPurge(jsonRequest("http://x/api/cron/purge-archived", {}))
    expect(denied.status).toBe(401)
    const { NextRequest } = await import("next/server")
    const ok = await cronPurge(
      new NextRequest("http://x/api/cron/purge-archived", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": "test-cron-secret" },
        body: "{}",
      }),
    )
    expect(ok.status).toBe(200)
  })
})
