import { type NextRequest, NextResponse } from "next/server"
import { hasRole, type User, type UserRole } from "./auth"
import { GUARD_SESSION_COOKIE } from "./guard-session.constants"
import { verifyGuardSessionCookie } from "./guard-session.node"
import { getUserByUsername } from "./user-storage"

export type SessionUser = User & {
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

  const dbUser = await getUserByUsername(payload.sub)
  const user: SessionUser = dbUser
    ? {
        username: dbUser.username,
        role: dbUser.role,
        additionalRoles: dbUser.additionalRoles,
        email: dbUser.email,
        fullName: dbUser.fullName,
        institution: dbUser.institution,
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
