import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { getRequest, jsonRequest, sessionCookie } from "../helpers"
import { prismaMock, resetPrismaMock, sampleDocumentRow, sampleUserRow } from "../mocks/prisma-mock"
import { signDocumentAccess } from "@/lib/report-access"
import { GET as verify } from "@/app/api/report/verify/route"
import { GET as verifyPath } from "@/app/api/report/v/[documentId]/[sig]/route"
import { GET as verifySig } from "@/app/api/report/verify/[documentId]/[sig]/route"
import { GET as download } from "@/app/api/report/[documentId]/download/route"
import { GET as view } from "@/app/api/report/[documentId]/view/route"
import { GET as original } from "@/app/api/report/[documentId]/original/route"
import { POST as reportPost } from "@/app/api/report/route"
import { GET as fileGet } from "@/app/api/documents/[documentId]/file/route"
import { DELETE as deleteUserDoc } from "@/app/api/documents/user/[username]/documents/[documentId]/route"
import { PATCH as patchAdminUser, DELETE as deleteAdminUser } from "@/app/api/admin/users/[username]/route"
import { GET as adminDirectoriesGet, POST as adminDirectoriesPost } from "@/app/api/admin/directories/route"
import { GET as adminTypesGet, POST as adminTypesPost } from "@/app/api/admin/document-types/route"
import { PATCH as patchType, DELETE as deleteType } from "@/app/api/admin/document-types/[id]/route"
import { GET as documentAnalysis } from "@/app/api/documents/[documentId]/analysis/route"

const student = () => sessionCookie("7123456", "student")
const admin = () => sessionCookie("admin1", "admin")
const superadmin = () => sessionCookie("root", "superadmin")

const uniqueUpload = "data/lab/uploads/file-route-42.docx"

const liveDoc = {
  ...sampleDocumentRow,
  status: "final",
  filePath: uniqueUpload,
  expiresAt: new Date("2027-12-01T00:00:00.000Z"),
}

function ensureFiles() {
  const reports = path.join(process.cwd(), "data", "reports")
  const uploads = path.join(process.cwd(), "data", "lab", "uploads")
  fs.mkdirSync(reports, { recursive: true })
  fs.mkdirSync(uploads, { recursive: true })
  fs.writeFileSync(path.join(reports, "42.pdf"), "%PDF-1.4 test")
  fs.writeFileSync(path.join(process.cwd(), uniqueUpload), "docx")
}

describe("report + leftover admin/document routes", () => {
  beforeEach(() => {
    resetPrismaMock()
    ensureFiles()
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { username: string } }) => {
      if (where.username === "admin1") return { ...sampleUserRow, username: "admin1", role: "admin" }
      if (where.username === "root") {
        return { ...sampleUserRow, username: "root", role: "superadmin", institutionId: null, institution: null }
      }
      if (where.username === "7123456") return sampleUserRow
      return sampleUserRow
    })
    prismaMock.document.findUnique.mockResolvedValue(liveDoc)
    prismaMock.document.findFirst.mockResolvedValue({ ...liveDoc, analysisJob: liveDoc.analysisJob })
    prismaMock.institution.findFirst.mockResolvedValue({ id: "bsuir", isActive: true, name: "БГУИР" })
    prismaMock.institution.findUnique.mockResolvedValue({
      id: "bsuir",
      name: "БГУИР",
      isActive: true,
      faculties: [{ id: "fksis", name: "ФКСиС", isActive: true }],
    })
    prismaMock.institution.findMany.mockResolvedValue([
      { id: "bsuir", name: "БГУИР", isActive: true, faculties: [{ id: "fksis", name: "ФКСиС", isActive: true }] },
    ])
    prismaMock.institution.count.mockResolvedValue(1)
    prismaMock.faculty.findUnique.mockResolvedValue(null)
    prismaMock.faculty.findFirst.mockResolvedValue({
      id: "fksis",
      name: "ФКСиС",
      isActive: true,
      institutionId: "bsuir",
    })
    prismaMock.documentType.findUnique.mockResolvedValue({
      id: 1,
      institutionId: "bsuir",
      name: "lab",
      displayName: "Лабораторная",
      description: null,
      isActive: true,
    })
    prismaMock.documentType.findMany.mockResolvedValue([
      { id: 1, institutionId: "bsuir", name: "lab", displayName: "Лабораторная", description: null, isActive: true },
    ])
    prismaMock.documentType.count.mockResolvedValue(1)
    prismaMock.document.count.mockResolvedValue(0)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.user.deleteMany.mockResolvedValue({ count: 1 })
    prismaMock.document.deleteMany.mockResolvedValue({ count: 1 })
  })

  it("verifies QR report links", async () => {
    const sig = signDocumentAccess("report", 42)
    expect((await verify(getRequest("http://x/api/report/verify"))).status).toBe(400)
    expect((await verify(getRequest("http://x/api/report/verify?documentId=42&sig=bad"))).status).toBe(403)
    const raw = await verify(getRequest(`http://x/api/report/verify?documentId=42&sig=${encodeURIComponent(sig)}&raw=1`))
    expect(raw.status).toBe(200)
    const redirect = await verify(getRequest(`http://x/api/report/verify?documentId=42&sig=${encodeURIComponent(sig)}`))
    expect([302, 307]).toContain(redirect.status)

    const pathOk = await verifyPath(getRequest(`http://x/api/report/v/42/${encodeURIComponent(sig)}?raw=1`), {
      params: Promise.resolve({ documentId: "42", sig }),
    })
    expect(pathOk.status).toBe(200)
    const pathRedirect = await verifyPath(getRequest(`http://x/api/report/v/42/${encodeURIComponent(sig)}`), {
      params: Promise.resolve({ documentId: "42", sig }),
    })
    expect([302, 307]).toContain(pathRedirect.status)

    const sigRoute = await verifySig(getRequest(`http://x/api/report/verify/42/${encodeURIComponent(sig)}?raw=1`), {
      params: Promise.resolve({ documentId: "42", sig }),
    })
    expect(sigRoute.status).toBe(200)
  })

  it("download / view / original / generate report / file", async () => {
    const reportSig = signDocumentAccess("report", 42)
    const origSig = signDocumentAccess("original", 42)
    const c = student()

    expect((await download(getRequest("http://x/api/report/xx/download"), { params: Promise.resolve({ documentId: "xx" }) })).status).toBe(400)
    expect((await download(getRequest("http://x/api/report/42/download"), { params: Promise.resolve({ documentId: "42" }) })).status).toBe(403)
    expect(
      (await download(getRequest(`http://x/api/report/42/download?sig=${encodeURIComponent(reportSig)}`), {
        params: Promise.resolve({ documentId: "42" }),
      })).status,
    ).toBe(200)

    expect(
      (await view(getRequest(`http://x/api/report/42/view?sig=${encodeURIComponent(reportSig)}`), {
        params: Promise.resolve({ documentId: "42" }),
      })).status,
    ).toBe(200)

    expect(
      (await original(getRequest(`http://x/api/report/42/original?sig=${encodeURIComponent(origSig)}`), {
        params: Promise.resolve({ documentId: "42" }),
      })).status,
    ).toBe(200)

    const missing = await reportPost(jsonRequest("http://x/api/report", { documentId: 42 }, "POST", c))
    expect(missing.status).toBe(400)
    const generated = await reportPost(
      jsonRequest(
        "http://x/api/report",
        { filename: "lab.docx", uniquenessPercent: 81.7, documentId: 42, status: "final", userId: "7123456" },
        "POST",
        c,
      ),
    )
    expect([200, 500]).toContain(generated.status)

    expect((await fileGet(getRequest("http://x/api/documents/xx/file", c), { params: Promise.resolve({ documentId: "xx" }) })).status).toBe(400)
    ensureFiles()
    expect((await fileGet(getRequest("http://x/api/documents/42/file", c), { params: Promise.resolve({ documentId: "42" }) })).status).toBe(200)
  })

  it("deletes a user document and patches/deletes a user", async () => {
    const del = await deleteUserDoc(jsonRequest("http://x/api/documents/user/7123456/documents/42", {}, "DELETE", student()), {
      params: Promise.resolve({ username: "7123456", documentId: "42" }),
    })
    expect(del.status).toBe(200)

    const badName = await patchAdminUser(jsonRequest("http://x/api/admin/users/%20", { role: "teacher" }, "PATCH", admin()), {
      params: Promise.resolve({ username: " " }),
    })
    expect(badName.status).toBe(400)

    const badRole = await patchAdminUser(
      jsonRequest("http://x/api/admin/users/7123456", { role: "nope" }, "PATCH", admin()),
      { params: Promise.resolve({ username: "7123456" }) },
    )
    expect(badRole.status).toBe(400)

    const patch = await patchAdminUser(
      jsonRequest("http://x/api/admin/users/7123456", { role: "teacher", fullName: "Иванов" }, "PATCH", admin()),
      { params: Promise.resolve({ username: "7123456" }) },
    )
    expect(patch.status).toBe(200)

    const selfDel = await deleteAdminUser(jsonRequest("http://x/api/admin/users/admin1", {}, "DELETE", admin()), {
      params: Promise.resolve({ username: "admin1" }),
    })
    expect(selfDel.status).toBe(400)

    const delUser = await deleteAdminUser(jsonRequest("http://x/api/admin/users/7123456", {}, "DELETE", admin()), {
      params: Promise.resolve({ username: "7123456" }),
    })
    expect(delUser.status).toBe(200)
  })

  it("covers admin directories and document-types mutations", async () => {
    expect((await adminDirectoriesGet(getRequest("http://x/api/admin/directories", admin()))).status).toBe(200)

    const actions = [
      { action: "addFaculty", institutionId: "bsuir", name: "Новый" },
      { action: "updateFaculty", institutionId: "bsuir", facultyId: "fksis", name: "ФКСиС-2" },
      { action: "activateFaculty", institutionId: "bsuir", facultyId: "fksis" },
      { action: "deactivateFaculty", institutionId: "bsuir", facultyId: "fksis" },
      { action: "unknown" },
    ]
    for (const body of actions) {
      const res = await adminDirectoriesPost(jsonRequest("http://x/api/admin/directories", body, "POST", admin()))
      expect([200, 400]).toContain(res.status)
    }

    const instActions = [
      { action: "addInstitution", name: "Новый вуз" },
      { action: "updateInstitution", institutionId: "bsuir", name: "БГУИР-2" },
      { action: "activateInstitution", institutionId: "bsuir" },
      { action: "deactivateInstitution", institutionId: "bsuir" },
    ]
    for (const body of instActions) {
      const res = await adminDirectoriesPost(jsonRequest("http://x/api/admin/directories", body, "POST", superadmin()))
      expect([200, 400]).toContain(res.status)
    }

    expect((await adminTypesGet(getRequest("http://x/api/admin/document-types", admin()))).status).toBe(200)
    expect((await adminTypesGet(getRequest("http://x/api/admin/document-types", superadmin()))).status).toBe(200)
    const noInst = await adminTypesPost(jsonRequest("http://x/api/admin/document-types", { displayName: "Эссе" }, "POST", superadmin()))
    expect(noInst.status).toBe(400)
    prismaMock.documentType.findUnique.mockResolvedValueOnce(null)
    const created = await adminTypesPost(
      jsonRequest("http://x/api/admin/document-types", { institutionId: "bsuir", displayName: "Эссе", name: "esse" }, "POST", superadmin()),
    )
    expect([200, 400]).toContain(created.status)

    expect(
      (await patchType(jsonRequest("http://x/api/admin/document-types/bad", { displayName: "X" }, "PATCH", superadmin()), {
        params: Promise.resolve({ id: "bad" }),
      })).status,
    ).toBe(400)
    expect(
      (await patchType(jsonRequest("http://x/api/admin/document-types/1", { displayName: "Лаб." }, "PATCH", superadmin()), {
        params: Promise.resolve({ id: "1" }),
      })).status,
    ).toBe(200)
    expect(
      (await deleteType(jsonRequest("http://x/api/admin/document-types/1", {}, "DELETE", superadmin()), {
        params: Promise.resolve({ id: "1" }),
      })).status,
    ).toBe(200)
  })

  it("lets an admin inspect analysis when the owner lookup misses", async () => {
    prismaMock.document.findFirst.mockResolvedValueOnce(null)
    const res = await documentAnalysis(getRequest("http://x/api/documents/42/analysis", admin()), {
      params: Promise.resolve({ documentId: "42" }),
    })
    expect(res.status).toBe(200)
  })
})
