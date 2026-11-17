import { describe, expect, it } from "vitest"
import { formatApiUploadError, prismaClientMessage } from "@/lib/prisma-error-message"
import { cn } from "@/lib/utils"
import { validateFile } from "@/lib/file-parser"
import { computeMinHashSignature, computeLocalPlagiarismPercent, adjustLocalPlagiarismPercent } from "@/lib/local-plagiarism"

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

  it("removes the constant extra MinHash similarity before showing originality", () => {
    const previous = process.env.LOCAL_PLAGIARISM_BASE
    process.env.LOCAL_PLAGIARISM_BASE = "23"
    expect(adjustLocalPlagiarismPercent(22.66)).toBe(0)
    expect(adjustLocalPlagiarismPercent(36.72)).toBeCloseTo(17.82, 1)
    expect(adjustLocalPlagiarismPercent(61.72)).toBeCloseTo(50.29, 1)
    expect(adjustLocalPlagiarismPercent(82.81)).toBeCloseTo(77.68, 1)
    expect(adjustLocalPlagiarismPercent(0)).toBe(0)
    if (previous == null) delete process.env.LOCAL_PLAGIARISM_BASE
    else process.env.LOCAL_PLAGIARISM_BASE = previous
  })
})
