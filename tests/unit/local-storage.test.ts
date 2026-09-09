import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock, sampleDocumentRow } from "../mocks/prisma-mock"
import {
  addDocumentToDb,
  computeDraftExpiresAt,
  getAllDocumentsFromDb,
  getDocumentAuthorLabel,
  getDocumentByIdFromDb,
  getDocumentsForComparison,
  getUserDocuments,
  getUserFinalDocuments,
  isDraftExpired,
  isFileAccessAllowed,
  purgeArchivedDocumentStorage,
  saveFileToDisk,
} from "@/lib/local-storage"
import fs from "node:fs"
import path from "node:path"

describe("local-storage", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.document.findMany.mockResolvedValue([sampleDocumentRow])
    prismaMock.document.findUnique.mockResolvedValue(sampleDocumentRow)
    prismaMock.document.create.mockResolvedValue({ id: 99, ...sampleDocumentRow })
  })

  it("computes draft TTL and file access", () => {
    const exp = computeDraftExpiresAt("2026-01-01T00:00:00.000Z")
    expect(new Date(exp).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00.000Z").getTime())
    const live = {
      ...sampleDocumentRow,
      uploadDate: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "draft" as const,
    }
    expect(isDraftExpired(live)).toBe(false)
    expect(isFileAccessAllowed({ ...live, filePath: "data/lab/x.docx" })).toBe(true)
    expect(isFileAccessAllowed({ ...live, status: "archived", filePath: "x" })).toBe(false)
  })

  it("labels authors", () => {
    expect(getDocumentAuthorLabel({ author: "Иванов" })).toBe("Иванов")
    expect(getDocumentAuthorLabel({ userId: "7123456" })).toBe("7123456")
    expect(getDocumentAuthorLabel({})).toBe("—")
  })

  it("reads documents from mocked prisma", async () => {
    expect((await getDocumentByIdFromDb(42))?.title).toBe("Лабораторная работа")
    expect((await getUserDocuments("7123456")).length).toBeGreaterThan(0)
    expect((await getUserFinalDocuments("7123456")).length).toBeGreaterThanOrEqual(0)
    const pool = await getDocumentsForComparison("lab", "bsuir", 1, "other")
    expect(Array.isArray(pool)).toBe(true)
    const all = await getAllDocumentsFromDb("other", "bsuir", ["lab"])
    expect(Array.isArray(all)).toBe(true)
  })

  it("adds a document and writes a file to disk", async () => {
    const created = await addDocumentToDb(
      "Новая",
      "текст ".repeat(40),
      Array.from({ length: 128 }, (_, i) => i),
      20,
      "a.docx",
      "a.docx",
      "lab",
      "draft",
      "7123456",
      "bsuir",
      80,
      10,
      5,
      1000,
      "word",
    )
    expect(created.id).toBeTruthy()
    const name = saveFileToDisk(Buffer.from("hello"), "work.docx", "lab")
    expect(name).toMatch(/work\.docx$/)
    const dir = path.join(process.cwd(), "data", "lab", "uploads")
    expect(fs.existsSync(dir)).toBe(true)
  })

  it("purges archived storage", async () => {
    prismaMock.document.findMany.mockResolvedValue([
      { ...sampleDocumentRow, status: "archived", filePath: null, id: 8 },
    ])
    const result = await purgeArchivedDocumentStorage()
    expect(result).toHaveProperty("purged")
  })
})
