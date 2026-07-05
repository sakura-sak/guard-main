import { type NextRequest, NextResponse } from "next/server"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"
import { sessionCookieOptions } from "@/lib/guard-session.node"

export async function POST(request: NextRequest) {
  const res = NextResponse.json({ success: true })
  res.cookies.set(GUARD_SESSION_COOKIE, "", sessionCookieOptions(request, 0))
  return res
}
