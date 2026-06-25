import { type NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/require-session-api"
import { getUserByUsername } from "@/lib/user-storage"
import { buildSessionUserPayload } from "@/lib/session-user-payload"

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
