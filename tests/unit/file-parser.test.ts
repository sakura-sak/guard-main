import { describe, expect, it, vi } from "vitest"

vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn(async () => ({ value: "текст   из документа word" })),
  },
}))

vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "страница" }, { str: "pdf" }] }),
      }),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: "" },
}))

import { parseFile, validateFile } from "@/lib/file-parser"

describe("file-parser", () => {
  it("validates extension and size", () => {
    expect(validateFile(new File(["a"], "work.docx")).valid).toBe(true)
    expect(validateFile(new File(["a"], "work.pdf")).valid).toBe(true)
    expect(validateFile(new File(["a"], "work.txt")).valid).toBe(false)
    const huge = new File(["x"], "big.pdf")
    Object.defineProperty(huge, "size", { value: 51 * 1024 * 1024 })
    expect(validateFile(huge).valid).toBe(false)
  })

  it("parses docx via mammoth and rejects unknown types", async () => {
    const parsed = await parseFile(new File(["docx-bytes"], "lab.docx"))
    expect(parsed.fileType).toBe("docx")
    expect(parsed.text).toContain("текст")
    expect(parsed.wordCount).toBeGreaterThan(0)
    await expect(parseFile(new File(["x"], "notes.txt"))).rejects.toThrow(/Unsupported/)
  })

  it("parses pdf via pdfjs", async () => {
    const parsed = await parseFile(new File(["%PDF"], "work.pdf"))
    expect(parsed.fileType).toBe("pdf")
    expect(parsed.text.toLowerCase()).toContain("pdf")
  })
})
