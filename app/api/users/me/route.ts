import { type NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/require-session-api"
import { getUserByUsername, updateUserProfile } from "@/lib/user-storage"
import { buildSessionUserPayload } from "@/lib/session-user-payload"
import { isStudentOrTeacher, profileEditPolicy } from "@/lib/roles"

export async function GET(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response
  const dbUser = await getUserByUsername(gate.user.username)
  if (!dbUser) {
    return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
  }
  return NextResponse.json({
    success: true,
    user: buildSessionUserPayload(dbUser),
  })
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response
  try {
    const dbUser = await getUserByUsername(gate.user.username)
    if (!dbUser) {
      return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 })
    }

    const body = await request.json()
    const { fullName, institution, faculty, group, email } = body
    const policy = profileEditPolicy(dbUser.role, dbUser.institutionId, dbUser.institution)

    if (isStudentOrTeacher(dbUser.role)) {
      if (institution !== undefined && !policy.institution) {
        return NextResponse.json({ success: false, error: "Нельзя изменить учебное заведение" }, { status: 403 })
      }
      if (faculty !== undefined && !policy.faculty) {
        return NextResponse.json({ success: false, error: "Факультет задаётся администратором" }, { status: 403 })
      }
      if (group !== undefined && !policy.group) {
        return NextResponse.json({ success: false, error: "Группу задаёт администратор" }, { status: 403 })
      }
    }

    const ok = await updateUserProfile(gate.user.username, {
      fullName: policy.fullName && typeof fullName === "string" ? fullName : undefined,
      institution: policy.institution && typeof institution === "string" ? institution : undefined,
      faculty: policy.faculty && typeof faculty === "string" ? faculty : undefined,
      group: policy.group && typeof group === "string" ? group : undefined,
      email: policy.email && typeof email === "string" ? email : undefined,
    })
    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось обновить профиль" }, { status: 500 })
    }
    const updated = await getUserByUsername(gate.user.username)
    return NextResponse.json({
      success: true,
      user: buildSessionUserPayload(updated!),
    })
  } catch {
    return NextResponse.json({ success: false, error: "Ошибка обновления профиля" }, { status: 500 })
  }
}
