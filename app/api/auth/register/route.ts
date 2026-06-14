import { type NextRequest, NextResponse } from "next/server"
import { registerUser } from "@/lib/user-storage"
import { logInfo, logError } from "@/lib/logger"

// POST - Регистрация нового пользователя
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password, role, email, fullName, institution } = body

    if (!username || !password) {
      return NextResponse.json({ success: false, error: "Логин и пароль обязательны" }, { status: 400 })
    }

    const result = await registerUser(username, password, role || "student", email, fullName, institution)

    if (result.success) {
      logInfo("Пользователь зарегистрирован", username, role, "register", { email, fullName })
      return NextResponse.json({
        success: true,
        user: result.user,
        message: "Пользователь успешно зарегистрирован",
      })
    } else {
      logError("Ошибка регистрации", result.error, username, role, "register")
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
  } catch (error) {
    logError("Ошибка при регистрации", error instanceof Error ? error : String(error), undefined, undefined, "register")
    return NextResponse.json({ success: false, error: "Ошибка при регистрации" }, { status: 500 })
  }
}
