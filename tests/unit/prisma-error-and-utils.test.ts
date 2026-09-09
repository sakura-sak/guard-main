import { describe, expect, it } from "vitest"
import { formatApiUploadError, prismaClientMessage } from "@/lib/prisma-error-message"
import { cn } from "@/lib/utils"
import { validateFile } from "@/lib/file-parser"
import { computeMinHashSignature, computeLocalPlagiarismPercent } from "@/lib/local-plagiarism"

describe("prismaClientMessage / formatApiUploadError", () => {
  it("maps known Prisma codes", () => {
    expect(prismaClientMessage({ code: "P2002" })).toMatch(/уникальности/)
    expect(prismaClientMessage({ code: "P1001" })).toMatch(/соединения/)
    expect(prismaClientMessage({ code: "P9999" })).toBeNull()
    expect(prismaClientMessage("x")).toBeNull()
  })

  it("formats upload errors", () => {
    expect(formatApiUploadError({ code: "P2025" })).toMatch(/не найдена/)
    expect(formatApiUploadError(new Error("payload too large"))).toMatch(/большой/)
    expect(formatApiUploadError(new Error("ETIMEDOUT"))).toMatch(/Таймаут/)
    expect(formatApiUploadError(new Error("other boom"))).toMatch(/other boom/)
    expect(formatApiUploadError(null)).toBe("Ошибка при загрузке файла")
  })
})

describe("cn / validateFile / MinHash helper", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toContain("a")
  })

  it("rejects unsupported files and oversized uploads", () => {
    expect(validateFile({ name: "a.txt", size: 10 } as File).valid).toBe(false)
    expect(validateFile({ name: "a.pdf", size: 60 * 1024 * 1024 } as File).valid).toBe(false)
    expect(validateFile({ name: "a.pdf", size: 100 } as File).valid).toBe(true)
  })

  it("builds a 128-length signature and returns 0 without institution", async () => {
    const { signature, shingles } = computeMinHashSignature("текст лабораторной работы для проверки")
    expect(signature).toHaveLength(128)
    expect(shingles.size).toBeGreaterThan(0)
    expect(await computeLocalPlagiarismPercent("x", signature, "lab", null)).toBe(0)
    expect(await computeLocalPlagiarismPercent("x", [1, 2], "lab", "bsuir")).toBe(0)
  })
})
