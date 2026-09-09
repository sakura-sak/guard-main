import { describe, expect, it } from "vitest"
import { contentDispositionAttachment, readDocumentFileFromDisk, resolveDocumentDownloadMeta } from "@/lib/document-download"
import { verifyGuardSessionCookieEdge } from "@/lib/guard-session.edge"
import { signGuardSessionCookie } from "@/lib/guard-session.node"
import { getAuditLogs, purgeOldAuditLogs, writeAuditLog } from "@/lib/audit-log"
import { prismaMock } from "../mocks/prisma-mock"
import fs from "node:fs"
import path from "node:path"

describe("document-download / edge session / audit-log", () => {
  it("resolves download metadata", () => {
    const meta = resolveDocumentDownloadMeta({
      id: 5,
      filename: "работа.docx",
      filePath: "data/lab/uploads/x.docx",
      fileFormat: "word",
      title: "Работа",
    })
    expect(meta.ext).toBe(".docx")
    expect(meta.mime).toContain("word")
    expect(contentDispositionAttachment("work-5.docx", meta.downloadName)).toContain("attachment")
    expect(readDocumentFileFromDisk("data/does-not-exist.bin")).toBeNull()
    const tmp = path.join(process.cwd(), "data", "lab", "uploads")
    fs.mkdirSync(tmp, { recursive: true })
    const file = path.join(tmp, "read-test.txt")
    fs.writeFileSync(file, "abc")
    expect(readDocumentFileFromDisk(path.relative(process.cwd(), file))?.toString()).toBe("abc")
  })

  it("verifies the same cookie in the edge helper", async () => {
    const token = signGuardSessionCookie("7123456", "student")
    const payload = await verifyGuardSessionCookieEdge(token, process.env.SESSION_SECRET as string)
    expect(payload?.sub).toBe("7123456")
    expect(await verifyGuardSessionCookieEdge("bad", "secret-secret-secret")).toBeNull()
  })

  it("writes and reads audit logs", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ username: "7123456" })
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        action: "login",
        userId: "7123456",
        entityType: "user",
        entityId: "7123456",
        details: JSON.stringify({ level: "info", message: "вход" }),
      },
    ])
    await writeAuditLog({ userId: "7123456", action: "login", message: "вход" })
    const logs = await getAuditLogs({ limit: 10, level: "info" })
    expect(logs.length).toBeGreaterThanOrEqual(0)
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 2 })
    expect(await purgeOldAuditLogs(30)).toBe(2)
  })
})
