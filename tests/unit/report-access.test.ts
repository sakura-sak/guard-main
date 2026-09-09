import { describe, expect, it } from "vitest"
import { signDocumentAccess, verifyDocumentAccess } from "@/lib/report-access"

describe("report QR access", () => {
  it("accepts a signature issued for the same document and type", () => {
    const sig = signDocumentAccess("report", 42)
    expect(verifyDocumentAccess("report", 42, sig)).toBe(true)
  })

  it("rejects a signature from another document or type", () => {
    const sig = signDocumentAccess("report", 42)
    expect(verifyDocumentAccess("report", 99, sig)).toBe(false)
    expect(verifyDocumentAccess("original", 42, sig)).toBe(false)
  })

  it("rejects empty or oversized signatures", () => {
    expect(verifyDocumentAccess("report", 1, "")).toBe(false)
    expect(verifyDocumentAccess("report", 1, "x".repeat(201))).toBe(false)
  })
})
