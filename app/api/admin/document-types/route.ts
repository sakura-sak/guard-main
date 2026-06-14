import { type NextRequest, NextResponse } from "next/server"
import { createDocumentType, getAllDocumentTypes } from "@/lib/document-types"
import { logError, logInfo } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const types = await getAllDocumentTypes(true)
    return NextResponse.json({ success: true, types })
  } catch (error) {
    console.error("Error fetching document types:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch document types" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const body = await request.json()
    const { displayName, name, description, isActive } = body
    const result = await createDocumentType({ displayName, name, description, isActive })

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    logInfo("Тип работы добавлен", gate.username, "admin", "add_document_type", {
      typeId: result.type?.id,
      displayName: result.type?.displayName,
    })

    return NextResponse.json({ success: true, type: result.type })
  } catch (error) {
    logError(
      "Ошибка при добавлении типа работы",
      error instanceof Error ? error : String(error),
      gate.username,
      "admin",
      "add_document_type",
    )
    return NextResponse.json({ success: false, error: "Ошибка при добавлении типа работы" }, { status: 500 })
  }
}
