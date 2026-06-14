import { type NextRequest, NextResponse } from "next/server"
import { deleteDocumentType, updateDocumentType } from "@/lib/document-types"
import { logError, logInfo } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10)
  return Number.isNaN(id) ? null : id
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  const { id: idRaw } = await params
  const id = parseId(idRaw)
  if (id == null) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { displayName, name, description, isActive } = body
    const result = await updateDocumentType(id, { displayName, name, description, isActive })

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 })
    }

    logInfo("Тип работы обновлён", gate.username, "admin", "update_document_type", { typeId: id })
    return NextResponse.json({ success: true, type: result.type })
  } catch (error) {
    logError(
      "Ошибка при обновлении типа работы",
      error instanceof Error ? error : String(error),
      gate.username,
      "admin",
      "update_document_type",
    )
    return NextResponse.json({ success: false, error: "Ошибка при обновлении типа работы" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  const { id: idRaw } = await params
  const id = parseId(idRaw)
  if (id == null) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  try {
    const result = await deleteDocumentType(id)
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 404 })
    }

    logInfo("Тип работы удалён", gate.username, "admin", "delete_document_type", { typeId: id })
    return NextResponse.json({ success: true })
  } catch (error) {
    logError(
      "Ошибка при удалении типа работы",
      error instanceof Error ? error : String(error),
      gate.username,
      "admin",
      "delete_document_type",
    )
    return NextResponse.json({ success: false, error: "Ошибка при удалении типа работы" }, { status: 500 })
  }
}
