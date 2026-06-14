import { NextResponse } from "next/server"
import { getDirectories } from "@/lib/directories"

export async function GET() {
  const institutions = await getDirectories()
  return NextResponse.json({ success: true, institutions })
}
