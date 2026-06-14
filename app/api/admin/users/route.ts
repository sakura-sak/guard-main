import { type NextRequest, NextResponse } from "next/server"
import { getAllUsers, registerUser, filterUsersBySearch } from "@/lib/user-storage"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { logInfo, logError } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"

// GET - Получение всех пользователей
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search") || ""
    let users = await getAllUsers()
    users = filterUsersBySearch(users, search)
    const documents = await getAllDocumentsFromDb()

    // Подсчитываем количество документов для каждого пользователя
    const userDocumentCounts = new Map<string, number>()
    documents.forEach((doc) => {
      if (doc.userId) {
        userDocumentCounts.set(doc.userId, (userDocumentCounts.get(doc.userId) || 0) + 1)
      }
    })

    // Возвращаем без паролей
    const usersData = users.map((user) => ({
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      additionalRoles: user.additionalRoles ?? [],
      institution: user.institution,
      faculty: user.faculty,
      group: user.group,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      documentCount: userDocumentCounts.get(user.username) || 0,
    }))

    return NextResponse.json({
      success: true,
      users: usersData,
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
    const { username, password, role, email, fullName, institution, faculty, group } = body

    if (!username || !password) {
      return NextResponse.json({ success: false, error: "Логин и пароль обязательны" }, { status: 400 })
    }

    const result = await registerUser(
      username,
      password,
      role || "student",
      email,
      fullName,
      institution,
      faculty,
      group,
    )

    if (result.success) {
      logInfo("Пользователь добавлен администратором", username, "admin", "add_user", {
        role,
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
