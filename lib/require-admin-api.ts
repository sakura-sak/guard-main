import { type NextRequest, NextResponse } from "next/server"
import { hasRole, type User, type UserRole } from "./auth"
import { GUARD_SESSION_COOKIE } from "./guard-session.constants"
import { verifyGuardSessionCookie } from "./guard-session.node"
import { getUserByUsername } from "./user-storage"
import { isStaffAdmin, isSuperAdmin } from "./roles"

export type AdminGateUser = User & {
  institutionId?: string
  faculty?: string
  group?: string
}

export type AdminGate =
  | {
      ok: true
      username: string
      role: UserRole
      institutionId?: string
      institution?: string
      isSuperAdmin: boolean
      isUniversityAdmin: boolean
    }
  | { ok: false; response: NextResponse }

function toUser(payload: {
  sub: string
  role: string
  ar?: User["additionalRoles"]
}): AdminGateUser {
  return {
    username: payload.sub,
    role: payload.role as UserRole,
    additionalRoles: payload.ar,
  }
}

/**
 * Session + role admin or superadmin. Returns institution scope for university admins.
 */
export async function requireAdminApi(request: NextRequest): Promise<AdminGate> {
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
  const user: AdminGateUser = dbUser
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

  if (!isStaffAdmin(user.role) && !hasRole(user, "admin") && !hasRole(user, "superadmin")) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Доступ только для администратора" }, { status: 403 }),
    }
  }

  const role = user.role
  const uniAdmin = role === "admin"

  if (uniAdmin && !user.institutionId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "У администратора не указано учебное заведение" },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    username: user.username,
    role,
    institutionId: user.institutionId,
    institution: user.institution,
    isSuperAdmin: isSuperAdmin(role),
    isUniversityAdmin: uniAdmin,
  }
}

export async function requireSuperAdminApi(request: NextRequest): Promise<AdminGate> {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate
  if (!gate.isSuperAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Доступ только для главного администратора" }, { status: 403 }),
    }
  }
  return gate
}

/** Ensure university admin only touches their institution. */
export function assertInstitutionAccess(
  gate: Extract<AdminGate, { ok: true }>,
  institutionId: string,
): NextResponse | null {
  if (gate.isSuperAdmin) return null
  if (gate.institutionId !== institutionId) {
    return NextResponse.json({ success: false, error: "Нет доступа к этому учебному заведению" }, { status: 403 })
  }
  return null
}

/** Ensure university admin only manages users in their institution. */
export function assertUserInScope(
  gate: Extract<AdminGate, { ok: true }>,
  target: { institutionId?: string | null; role: UserRole },
): NextResponse | null {
  if (gate.isSuperAdmin) return null
  if (target.institutionId !== gate.institutionId) {
    return NextResponse.json({ success: false, error: "Пользователь вне вашего учебного заведения" }, { status: 403 })
  }
  if (target.role === "superadmin" || target.role === "admin") {
    return NextResponse.json({ success: false, error: "Недостаточно прав для управления этим пользователем" }, { status: 403 })
  }
  return null
}
