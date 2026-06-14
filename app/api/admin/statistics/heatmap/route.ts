import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

/**
 * GET /api/admin/statistics/heatmap
 * Возвращает количество загрузок по дням за выбранный год.
 * Параметры: year (обязательный), status (через запятую: draft,final или пусто = все),
 *            category (через запятую: diploma,coursework,... или пусто = все)
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get("year")
    const year = yearParam ? Number.parseInt(yearParam, 10) : new Date().getFullYear()
    const statusParam = searchParams.get("status") || ""
    const categoryParam = searchParams.get("category") || ""

    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : []
    const categories = categoryParam ? categoryParam.split(",").filter(Boolean) : []

    const documents = await getAllDocumentsFromDb()

    let filtered = documents
    if (statuses.length > 0) {
      filtered = filtered.filter((doc) => statuses.includes(doc.status))
    }
    if (categories.length > 0) {
      filtered = filtered.filter((doc) => categories.includes(doc.category || "uncategorized"))
    }

    const dailyCounts: Record<string, number> = {}
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31)
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      const key = new Date(t).toISOString().split("T")[0]
      dailyCounts[key] = 0
    }

    filtered.forEach((doc) => {
      const dateStr = new Date(doc.uploadDate).toISOString().split("T")[0]
      const [y] = dateStr.split("-").map(Number)
      if (y === year) {
        dailyCounts[dateStr] = (dailyCounts[dateStr] ?? 0) + 1
      }
    })

    return NextResponse.json({
      success: true,
      year,
      dailyCounts,
    })
  } catch (error) {
    console.error("Error fetching heatmap:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch heatmap" }, { status: 500 })
  }
}
