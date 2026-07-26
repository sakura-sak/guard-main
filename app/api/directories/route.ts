import { type NextRequest, NextResponse } from "next/server"
import { getDirectories } from "@/lib/directories"

/** Public: active УО and faculties only (for student/teacher forms). */
export async function GET() {
  const institutions = await getDirectories({ activeOnly: true })
  return NextResponse.json({ success: true, institutions })
}
