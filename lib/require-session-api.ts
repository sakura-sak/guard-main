import { type NextRequest, NextResponse } from "next/server"
import { hasRole, type User, type UserRole } from "./auth"
import { GUARD_SESSION_COOKIE } from "./guard-session.constants"
import {
  getSessionCookieMaxAgeSec,
  getSessionIdleTimeoutSec,
  sessionCookieOptions,
  signGuardSessionCookie,
  verifyGuardSessionCookie,
} from "./guard-session.node"
import type { GuardSessionPayload } from "./guard-session.types"
import { getUserByUsername } from "./user-storage"

export type SessionUser = User & {
  institutionId?: string
  faculty?: string
  group?: string
}

function toUser(payload: {
  sub: string
  role: string
  ar?: UserRole[]
}): SessionUser {
  return {
    username: payload.sub,
    role: payload.role as UserRole,
    additionalRoles: payload.ar,
  }
}

async function refreshSessionCookie(request: NextRequest, payload: GuardSessionPayload): Promise<void> {
  const maxAge = getSessionCookieMaxAgeSec()
  const token = signGuardSessionCookie(payload.sub, payload.role, payload.ar, maxAge, Date.now())
  try {
    const { cookies } = await import("next/headers")
    const jar = await cookies()
    jar.set(GUARD_SESSION_COOKIE, token, sessionCookieOptions(request, maxAge))
  } catch {
    /* no request cookie store (unit tests) */
  }
}

export async function requireSessionApi(
  request: NextRequest,
  allowedRoles?: UserRole[],
): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
  const raw = request.cookies.get(GUARD_SESSION_COOKIE)?.value
  if (!raw) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Требуется вход" }, { status: 401 }),
    }
  }
  const payload = verifyGuardSessionCookie(raw)
  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Сессия недействительна или истекла" }, { status: 401 }),
    }
  }

  const idleTimeoutSec = getSessionIdleTimeoutSec()
  if (idleTimeoutSec > 0) {
    const lastAct = typeof payload.act === "number" && Number.isFinite(payload.act) ? payload.act : Date.now()
    if (Date.now() - lastAct > idleTimeoutSec * 1000) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: "Сессия недействительна или истекла" }, { status: 401 }),
      }
    }
    await refreshSessionCookie(request, payload)
  }

  const dbUser = await getUserByUsername(payload.sub)
  const user: SessionUser = dbUser
    ? {
        username: dbUser.username,
        role: dbUser.role,
        additionalRoles: dbUser.additionalRoles,
        email: dbUser.email,
        fullName: dbUser.fullName,
        institution: dbUser.institution,
        institutionId: dbUser.institutionId,
        faculty: dbUser.faculty,
        group: dbUser.group,
      }
    : toUser({ sub: payload.sub, role: String(payload.role), ar: payload.ar })

  if (allowedRoles && allowedRoles.length > 0) {
    const allowed = allowedRoles.some((r) => hasRole(user, r))
    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json({ success: false, error: "Недостаточно прав" }, { status: 403 }),
      }
    }
  }

  return { ok: true, user }
}
