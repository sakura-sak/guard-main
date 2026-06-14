import { NextResponse } from "next/server"
import { GUARD_SESSION_COOKIE } from "@/lib/guard-session.constants"

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(GUARD_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return res
}
