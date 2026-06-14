import { type NextRequest, NextResponse } from "next/server"
import { getDocumentByIdFromDb, updateDocumentTitle, updateDocumentCategory } from "@/lib/local-storage"
import { writeAuditLog } from "@/lib/audit-log"
import { requireSessionApi } from "@/lib/require-session-api"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  const { documentId } = await params
  const id = parseInt(documentId, 10)
  if (Number.isNaN(id)) {
    return NextResponse.json({ success: false, error: "Некорректный ID" }, { status: 400 })
  }

  const doc = await getDocumentByIdFromDb(id)
  if (!doc) {
    return NextResponse.json({ success: false, error: "Документ не найден" }, { status: 404 })
  }

  const isOwner = doc.userId === gate.user.username
  const isAdmin = gate.user.role === "admin" || gate.user.role === "superadmin"
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ success: false, error: "Нет доступа" }, { status: 403 })
  }

  const body = await request.json()
  const { title, category } = body

  if (title !== undefined) {
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ success: false, error: "Название обязательно" }, { status: 400 })
    }
    const ok = await updateDocumentTitle(id, title)
    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось обновить название" }, { status: 500 })
    }
  }

  if (category !== undefined) {
    if (!category || typeof category !== "string" || !category.trim()) {
      return NextResponse.json({ success: false, error: "Категория обязательна" }, { status: 400 })
    }
    const ok = await updateDocumentCategory(id, category)
    if (!ok) {
      return NextResponse.json({ success: false, error: "Не удалось обновить тип работы" }, { status: 500 })
    }
  }

  await writeAuditLog({
    userId: gate.user.username,
    action: isAdmin ? "admin_update_document" : "update_document",
    level: "info",
    message: `Документ #${id} обновлён`,
    entityType: "document",
    entityId: id,
    details: { title, category },
  })

  return NextResponse.json({ success: true, title: title?.trim(), category: category?.trim() })
}
