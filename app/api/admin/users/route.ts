import { type NextRequest, NextResponse } from "next/server"
import type { UserRole } from "@/lib/auth"
import { getAllUsers, registerUser, filterUsersBySearch } from "@/lib/user-storage"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { logInfo, logError } from "@/lib/logger"
import { assertUserInScope, requireAdminApi } from "@/lib/require-admin-api"
import { adminCanChangeUserPassword, canAssignRole, creatableRolesFor } from "@/lib/roles"

// GET - Получение всех пользователей
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    let users = await getAllUsers()

    if (gate.isUniversityAdmin && gate.institutionId) {
      users = users.filter((u) => u.institutionId === gate.institutionId)
      users = users.filter((u) => u.role === "student" || u.role === "teacher")
    }

    users = filterUsersBySearch(users, search)
    const documents = await getAllDocumentsFromDb(
      undefined,
      gate.isUniversityAdmin ? gate.institutionId : undefined,
    )

    const userDocumentCounts = new Map<string, number>()
    documents.forEach((doc) => {
      if (doc.userId) {
        userDocumentCounts.set(doc.userId, (userDocumentCounts.get(doc.userId) || 0) + 1)
      }
    })

    const usersData = users.map((user) => ({
      username: user.username,
      password: user.password,
      passwordEditable: adminCanChangeUserPassword(user.institutionId, user.institution),
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      additionalRoles: user.additionalRoles ?? [],
      institution: user.institution,
      institutionId: user.institutionId,
      faculty: user.faculty,
      group: user.group,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      documentCount: userDocumentCounts.get(user.username) || 0,
    }))

    return NextResponse.json({
      success: true,
      users: usersData,
      creatableRoles: creatableRolesFor(gate.role),
      scope: gate.isSuperAdmin ? "all" : "institution",
      institutionId: gate.institutionId ?? null,
      institution: gate.institution ?? null,
    })
  } catch (error) {
    console.error("Error fetching users:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch users" }, { status: 500 })
  }
}

// POST - Добавление нового пользователя
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const body = await request.json()
    let { username, password, role, email, fullName, institution, faculty, group } = body

    if (!username || !password) {
      return NextResponse.json({ success: false, error: "Логин и пароль обязательны" }, { status: 400 })
    }

    const targetRole = (role || "student") as UserRole
    if (!canAssignRole(gate.role, targetRole)) {
      return NextResponse.json({ success: false, error: "Недостаточно прав для создания пользователя с этой ролью" }, { status: 403 })
    }

    if (gate.isUniversityAdmin) {
      institution = gate.institution
      if (targetRole === "admin" || targetRole === "superadmin") {
        return NextResponse.json({ success: false, error: "Администратор УО может создавать только студентов и преподавателей" }, { status: 403 })
      }
    }

    if (targetRole === "admin" && !institution) {
      return NextResponse.json({ success: false, error: "Для администратора УО укажите учебное заведение" }, { status: 400 })
    }

    const result = await registerUser(
      username,
      password,
      targetRole,
      email,
      fullName,
      institution,
      faculty,
      group,
    )

    if (result.success) {
      logInfo("Пользователь добавлен администратором", gate.username, gate.role, "add_user", {
        role: targetRole,
        institution,
      })
      return NextResponse.json({
        success: true,
        user: result.user,
        message: "Пользователь успешно добавлен",
      })
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
  } catch (error) {
    logError("Ошибка при добавлении пользователя", error instanceof Error ? error : String(error), undefined, "admin", "add_user")
    return NextResponse.json({ success: false, error: "Ошибка при добавлении пользователя" }, { status: 500 })
  }
}
