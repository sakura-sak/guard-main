import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const getUserByUsername = vi.fn()
const registerUser = vi.fn()
vi.mock("@/lib/user-storage", () => ({
  getUserByUsername: (...args: unknown[]) => getUserByUsername(...args),
  registerUser: (...args: unknown[]) => registerUser(...args),
}))

import { ensureMoodleStudent, requireSessionOrMoodleApi } from "@/lib/require-moodle-api"
import { sampleUserRow } from "../mocks/prisma-mock"

function moodleRequest(url = "http://x/api/upload", extra: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "GET",
    headers: {
      "x-api-key": "moodle-test-key-16chars",
      ...extra,
    },
  })
}

describe("requireSessionOrMoodleApi", () => {
  beforeEach(() => {
    vi.stubEnv("MOODLE_API_KEY", "moodle-test-key-16chars")
    getUserByUsername.mockReset()
    registerUser.mockReset()
  })

  it("rejects a request with neither session nor Moodle key", async () => {
    const gate = await requireSessionOrMoodleApi(new NextRequest("http://x/api/upload"))
    expect(gate.ok).toBe(false)
  })

  it("creates a student from LDAP uid and accepts the Moodle key", async () => {
    getUserByUsername.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...sampleUserRow,
      username: "7123456",
    })
    registerUser.mockResolvedValue({ success: true })
    const gate = await requireSessionOrMoodleApi(moodleRequest("http://x/api/upload?username=7123456"))
    expect(gate.ok).toBe(true)
    if (gate.ok) {
      expect(gate.viaMoodle).toBe(true)
      expect(gate.user.username).toBe("7123456")
    }
    expect(registerUser).toHaveBeenCalled()
  })

  it("rejects a Moodle key when MOODLE_API_KEY is not configured", async () => {
    vi.stubEnv("MOODLE_API_KEY", "")
    const gate = await requireSessionOrMoodleApi(moodleRequest("http://x/api/upload?username=7123456"))
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(503)
    }
  })

  it("accepts Authorization Bearer when X-API-Key is absent", async () => {
    getUserByUsername.mockResolvedValue({ ...sampleUserRow, username: "7123456" })
    const gate = await requireSessionOrMoodleApi(
      new NextRequest("http://x/api/upload?username=7123456", {
        method: "GET",
        headers: { authorization: "Bearer moodle-test-key-16chars" },
      }),
    )
    expect(gate.ok).toBe(true)
    if (gate.ok) expect(gate.viaMoodle).toBe(true)
  })

  it("rejects a wrong Moodle key without falling back to a cookie session", async () => {
    const gate = await requireSessionOrMoodleApi(
      moodleRequest("http://x/api/upload?username=7123456", { "x-api-key": "wrong-key-16chars!!" }),
    )
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.response.status).toBe(401)
      const body = await gate.response.json()
      expect(body.error).toMatch(/X-API-Key/)
    }
  })

  it("uses an existing user without registering again", async () => {
    getUserByUsername.mockResolvedValue({ ...sampleUserRow, username: "7123456" })
    const created = await ensureMoodleStudent({ username: "7123456", institution: "БГУИР" })
    expect("username" in created && created.username).toBe("7123456")
    expect(registerUser).not.toHaveBeenCalled()
  })
})
