import { describe, expect, it } from "vitest"
import { getErrorStats, getLogs, logDebug, logError, logInfo, logWarning } from "@/lib/logger"

describe("logger", () => {
  it("writes info/warning/error/debug and can read them back", () => {
    logInfo("тест info", "u1", "student", "login")
    logWarning("тест warn", "u1", "student", "upload")
    logError("тест error", new Error("boom"), "u1", "student", "upload")
    logDebug("тест debug", "u1", "student", "analysis_request")
    const logs = getLogs()
    expect(logs.length).toBeGreaterThan(0)
    expect(getErrorStats().totalErrors).toBeGreaterThanOrEqual(1)
  })
})
