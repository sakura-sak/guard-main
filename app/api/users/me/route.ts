import { type NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/require-session-api"
import { getUserByUsername, updateUserProfile } from "@/lib/user-storage"

export async function GET(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response
  const dbUser = await getUserByUsername(gate.user.username)
  if (!dbUser) {
    return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
  }
  return NextResponse.json({
    success: true,
    user: {
      username: dbUser.username,
      role: dbUser.role,
      fullName: dbUser.fullName,
      email: dbUser.email,
      institution: dbUser.institution ?? "БГУИР",
      faculty: dbUser.faculty,
      group: dbUser.group,
    },
  })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response
  try {
    const body = await request.json()
    const { fullName, institution, faculty, group, email } = body
    const ok = await updateUserProfile(gate.user.username, {
      fullName: typeof fullName === "string" ? fullName : undefined,
      institution: typeof institution === "string" ? institution : undefined,
      faculty: typeof faculty === "string" ? faculty : undefined,
      group: typeof group === "string" ? group : undefined,
      email: typeof email === "string" ? email : undefined,
    })
    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось обновить профиль" }, { status: 500 })
    }
    const dbUser = await getUserByUsername(gate.user.username)
    return NextResponse.json({
      success: true,
      user: {
        username: dbUser!.username,
        role: dbUser!.role,
        fullName: dbUser!.fullName,
        email: dbUser!.email,
        institution: dbUser!.institution ?? "БГУИР",
        faculty: dbUser!.faculty,
        group: dbUser!.group,
      },
    })
  } catch {
    return NextResponse.json({ success: false, error: "Ошибка обновления профиля" }, { status: 500 })
  }
}
