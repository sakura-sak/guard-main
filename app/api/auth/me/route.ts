import { type NextRequest, NextResponse } from "next/server"
import { requireSessionApi } from "@/lib/require-session-api"

export async function GET(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response
  const { user } = gate
  return NextResponse.json({
    success: true,
    user: {
      username: user.username,
      role: user.role,
      additionalRoles: user.additionalRoles ?? [],
      fullName: user.fullName,
      email: user.email,
      institution: user.institution ?? "БГУИР",
      faculty: user.faculty,
      group: user.group,
    },
  })
}
