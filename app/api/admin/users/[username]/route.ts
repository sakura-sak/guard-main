import { type NextRequest, NextResponse } from "next/server"
import type { UserRole } from "@/lib/auth"
import { logError, logInfo } from "@/lib/logger"
import { assertUserInScope, requireAdminApi } from "@/lib/require-admin-api"
import { adminCanChangeUserPassword, canAssignRole } from "@/lib/roles"
import { deleteUser, getUserByUsername, updateUserByAdmin } from "@/lib/user-storage"

const VALID_ROLES: UserRole[] = ["student", "teacher", "admin", "superadmin"]

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && VALID_ROLES.includes(value as UserRole)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  const { username } = await params
  const target = decodeURIComponent(username || "").trim()
  if (!target) {
    return NextResponse.json({ success: false, error: "Логин обязателен" }, { status: 400 })
  }

  try {
    const existing = await getUserByUsername(target)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
    }

    const scopeErr = assertUserInScope(gate, existing)
    if (scopeErr) return scopeErr

    const body = await request.json()
    const {
      password,
      role,
      additionalRoles,
      email,
      fullName,
      institution,
      faculty,
      group,
    } = body

    if (role !== undefined) {
      if (!isUserRole(role)) {
        return NextResponse.json({ success: false, error: "Некорректная роль" }, { status: 400 })
      }
      if (!canAssignRole(gate.role, role)) {
        return NextResponse.json({ success: false, error: "Недостаточно прав для назначения этой роли" }, { status: 403 })
      }
    }
    if (additionalRoles !== undefined) {
      if (!Array.isArray(additionalRoles) || !additionalRoles.every(isUserRole)) {
        return NextResponse.json({ success: false, error: "Некорректные дополнительные роли" }, { status: 400 })
      }
    }
    if (password !== undefined && password !== "" && String(password).length < 6) {
      return NextResponse.json({ success: false, error: "Пароль должен содержать минимум 6 символов" }, { status: 400 })
    }
    if (
      password !== undefined &&
      password !== "" &&
      !adminCanChangeUserPassword(existing.institutionId, existing.institution)
    ) {
      return NextResponse.json(
        { success: false, error: "Пароль пользователей БГУИР нельзя изменить через панель администратора" },
        { status: 403 },
      )
    }

    const patchInstitution = gate.isUniversityAdmin ? gate.institution : institution

    const ok = await updateUserByAdmin(target, {
      password:
        password && adminCanChangeUserPassword(existing.institutionId, existing.institution)
          ? String(password)
          : undefined,
      role,
      additionalRoles,
      email,
      fullName,
      institution: patchInstitution,
      faculty,
      group,
    })

    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось обновить пользователя" }, { status: 500 })
    }

    const updated = await getUserByUsername(target)
    logInfo("Пользователь обновлён администратором", gate.username, gate.role, "update_user", { target })

    return NextResponse.json({
      success: true,
      user: updated
        ? {
            username: updated.username,
            fullName: updated.fullName,
            email: updated.email,
            role: updated.role,
            additionalRoles: updated.additionalRoles ?? [],
            institution: updated.institution,
            institutionId: updated.institutionId,
            faculty: updated.faculty,
            group: updated.group,
            createdAt: updated.createdAt,
            lastLogin: updated.lastLogin,
          }
        : undefined,
    })
  } catch (error) {
    logError(
      "Ошибка при обновлении пользователя",
      error instanceof Error ? error : String(error),
      gate.username,
      gate.role,
      "update_user",
    )
    return NextResponse.json({ success: false, error: "Ошибка при обновлении пользователя" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  const { username } = await params
  const target = decodeURIComponent(username || "").trim()
  if (!target) {
    return NextResponse.json({ success: false, error: "Логин обязателен" }, { status: 400 })
  }

  if (target === gate.username) {
    return NextResponse.json({ success: false, error: "Нельзя удалить свою учётную запись" }, { status: 400 })
  }

  try {
    const existing = await getUserByUsername(target)
    if (!existing) {
      return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
    }

    const scopeErr = assertUserInScope(gate, existing)
    if (scopeErr) return scopeErr

    const ok = await deleteUser(target)
    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось удалить пользователя" }, { status: 500 })
    }

    logInfo("Пользователь удалён администратором", gate.username, gate.role, "delete_user", { target })
    return NextResponse.json({ success: true })
  } catch (error) {
    logError(
      "Ошибка при удалении пользователя",
      error instanceof Error ? error : String(error),
      gate.username,
      gate.role,
      "delete_user",
    )
    return NextResponse.json({ success: false, error: "Ошибка при удалении пользователя" }, { status: 500 })
  }
}
