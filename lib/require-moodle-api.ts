import { type NextRequest, NextResponse } from "next/server"
import type { SessionUser } from "./require-session-api"
import { requireSessionApi } from "./require-session-api"
import { getUserByUsername, registerUser } from "./user-storage"

const LDAP_AUTH_ONLY_USER_MARKER = "LDAP_AUTH_ONLY_USER_MARKER"

function keysEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readMoodleApiKey(): string {
  return process.env.MOODLE_API_KEY?.trim() || ""
}

/** X-API-Key, or Authorization: Bearer (some proxies drop custom headers). */
export function readProvidedMoodleApiKey(request: NextRequest): string {
  const header = request.headers.get("x-api-key")?.trim() || ""
  if (header !== "") return header
  const auth = request.headers.get("authorization")?.trim() || ""
  const bearer = /^Bearer\s+(\S+)/i.exec(auth)
  return bearer?.[1]?.trim() || ""
}

export function requestHasMoodleApiKey(request: NextRequest): boolean {
  const expected = readMoodleApiKey()
  if (expected.length < 16) return false
  const provided = readProvidedMoodleApiKey(request)
  return provided.length === expected.length && keysEqual(provided, expected)
}

export function resolveMoodleUsername(
  request: NextRequest,
  formUsername?: string | null,
): string {
  const fromForm = formUsername?.trim() || ""
  const fromQuery = request.nextUrl.searchParams.get("username")?.trim() || ""
  const fromHeader = request.headers.get("x-moodle-username")?.trim() || ""
  return fromForm || fromQuery || fromHeader
}

export async function ensureMoodleStudent(options: {
  username: string
  institution?: string | null
  fullName?: string | null
}): Promise<SessionUser | { error: string; status: number }> {
  const username = options.username.trim()
  if (username.length < 3) {
    return { error: "Логин Moodle (username) обязателен", status: 400 }
  }

  let stored = await getUserByUsername(username)
  if (!stored) {
    const created = await registerUser(
      username,
      LDAP_AUTH_ONLY_USER_MARKER,
      "student",
      undefined,
      options.fullName?.trim() || undefined,
      options.institution?.trim() || "БГУИР",
    )
    if (!created.success) {
      return { error: created.error || "Не удалось создать пользователя Moodle", status: 400 }
    }
    stored = await getUserByUsername(username)
  }
  if (!stored) {
    return { error: "Пользователь Moodle не найден", status: 404 }
  }

  return {
    username: stored.username,
    role: stored.role,
    additionalRoles: stored.additionalRoles,
    email: stored.email,
    fullName: stored.fullName,
    institution: stored.institution,
    institutionId: stored.institutionId,
    faculty: stored.faculty,
    group: stored.group,
  }
}

/**
 * Cookie session, or Moodle plugin with X-API-Key = MOODLE_API_KEY.
 * Username is LDAP uid from the plugin (form / query / header).
 */
export async function requireSessionOrMoodleApi(
  request: NextRequest,
  extras?: { username?: string | null; fullName?: string | null; institution?: string | null },
): Promise<{ ok: true; user: SessionUser; viaMoodle: boolean } | { ok: false; response: NextResponse }> {
  const provided = readProvidedMoodleApiKey(request)
  if (provided !== "") {
    const expected = readMoodleApiKey()
    if (expected.length < 16) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            error: "На Guard не задан MOODLE_API_KEY (минимум 16 символов). Пропишите его в .env и перезапустите контейнер app.",
          },
          { status: 503 },
        ),
      }
    }
    if (provided.length !== expected.length || !keysEqual(provided, expected)) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: "Неверный X-API-Key: не совпадает с MOODLE_API_KEY на Guard" },
          { status: 401 },
        ),
      }
    }
    const username = resolveMoodleUsername(request, extras?.username)
    const userOrErr = await ensureMoodleStudent({
      username,
      institution: extras?.institution,
      fullName: extras?.fullName,
    })
    if ("error" in userOrErr) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: userOrErr.error }, { status: userOrErr.status }),
      }
    }
    return { ok: true, user: userOrErr, viaMoodle: true }
  }

  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate
  return { ok: true, user: gate.user, viaMoodle: false }
}
