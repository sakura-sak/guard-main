import { type NextRequest, NextResponse } from "next/server"
import { hasRole, type User } from "./auth"
import { GUARD_SESSION_COOKIE } from "./guard-session.constants"
import { verifyGuardSessionCookie } from "./guard-session.node"
import { getUserByUsername } from "./user-storage"

function toUser(payload: {
  sub: string
  role: string
  ar?: User["additionalRoles"]
}): User {
  return {
    username: payload.sub,
    role: payload.role as User["role"],
    additionalRoles: payload.ar,
  }
}

/**
 * Проверка httpOnly-сессии и роли admin/superadmin (учёт additionalRoles).
 * Если пользователь есть в БД — роли берутся из БД.
 */
export async function requireAdminApi(
  request: NextRequest,
): Promise<{ ok: true; username: string } | { ok: false; response: NextResponse }> {
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
  const user: User = dbUser
    ? {
        username: dbUser.username,
        role: dbUser.role,
        additionalRoles: dbUser.additionalRoles,
        email: dbUser.email,
        fullName: dbUser.fullName,
        institution: dbUser.institution,
      }
    : toUser({ sub: payload.sub, role: String(payload.role), ar: payload.ar })

  if (!hasRole(user, "admin") && !hasRole(user, "superadmin")) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Доступ только для администратора" }, { status: 403 }),
    }
  }

  return { ok: true, username: user.username }
}
