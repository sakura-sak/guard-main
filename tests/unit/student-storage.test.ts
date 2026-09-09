import { beforeEach, describe, expect, it } from "vitest"
import {
  clearCheckHistory,
  deleteCheckHistoryItem,
  getCheckHistory,
  saveCheckResult,
} from "@/lib/student-storage"
import { saveSession, getSession, clearSession } from "@/lib/auth"

const store = new Map<string, string>()

describe("browser storage helpers", () => {
  beforeEach(() => {
    store.clear()
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true })
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true })
  })

  it("saves and filters check history", () => {
    saveCheckResult(
      { filename: "a.docx", fileType: "docx", wordCount: 10, text: "t" },
      {
        uniquenessPercent: 80,
        totalDocumentsChecked: 3,
        similarDocuments: [{ similarity: 20 }],
        processingTimeMs: 10,
        status: "draft",
      },
    )
    expect(getCheckHistory()).toHaveLength(1)
    deleteCheckHistoryItem(getCheckHistory()[0].id)
    expect(getCheckHistory()).toHaveLength(0)
    clearCheckHistory()
    expect(getCheckHistory()).toEqual([])
  })

  it("stores a UI session in localStorage", () => {
    saveSession({ username: "u", role: "student" })
    expect(getSession()?.username).toBe("u")
    clearSession()
  })
})
