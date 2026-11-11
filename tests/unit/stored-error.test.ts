import { describe, expect, it } from "vitest"
import { formatStoredError, inferErrorCode, parseStoredError } from "@/lib/stored-error"

describe("stored-error", () => {
  it("round-trips a known code", () => {
    const stored = formatStoredError("no_text", "пусто")
    expect(parseStoredError(stored)).toEqual({ errorCode: "no_text", error: "пусто" })
  })

  it("infers timeout and auth from a plain message", () => {
    expect(inferErrorCode("ML request timed out after 30000ms")).toBe("timeout")
    expect(parseStoredError("HTTP 401: unauthorized").errorCode).toBe("auth")
    expect(parseStoredError("HTTP 503: down").errorCode).toBe("unavailable")
  })
})
