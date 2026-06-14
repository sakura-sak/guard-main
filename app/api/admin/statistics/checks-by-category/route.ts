import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

/**
 * GET /api/admin/statistics/checks-by-category
 * Для графика 2 (круговой): категория и кол-во загрузок. Фильтрация только по дате.
 * Параметры: startDate, endDate (YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate") || ""
    const endDate = searchParams.get("endDate") || ""

    const documents = await getAllDocumentsFromDb()

    let filtered = documents
    if (startDate) {
      filtered = filtered.filter((doc) => new Date(doc.uploadDate) >= new Date(startDate))
    }
    if (endDate) {
      filtered = filtered.filter((doc) => new Date(doc.uploadDate) <= new Date(endDate))
    }

    const categoryCounts = new Map<string, number>()
    filtered.forEach((doc) => {
      const cat = doc.category || "uncategorized"
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    })

    const checksByCategory = Array.from(categoryCounts.entries()).map(([category, count]) => ({
      category,
      count,
    }))

    return NextResponse.json({
      success: true,
      checksByCategory,
    })
  } catch (error) {
    console.error("Error fetching checks by category:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch" }, { status: 500 })
  }
}
