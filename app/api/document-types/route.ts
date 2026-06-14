import { NextResponse } from "next/server"
import { getAllDocumentTypes } from "@/lib/document-types"

export async function GET() {
  try {
    const types = await getAllDocumentTypes(false)
    return NextResponse.json({ success: true, types })
  } catch (error) {
    console.error("Error fetching document types:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch document types" }, { status: 500 })
  }
}
