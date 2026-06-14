import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

/**
 * GET /api/admin/statistics/originality-by-date
 * Для графика 3: процент оригинальности по датам, по типам работ.
 * Параметры: startDate, endDate (YYYY-MM-DD), status (через запятую), category (через запятую)
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate") || ""
    const endDate = searchParams.get("endDate") || ""
    const statusParam = searchParams.get("status") || ""
    const categoryParam = searchParams.get("category") || ""

    const statuses = statusParam ? statusParam.split(",").filter(Boolean) : []
    const categories = categoryParam ? categoryParam.split(",").filter(Boolean) : []

    const documents = await getAllDocumentsFromDb()

    let filtered = documents.filter((doc) => doc.originalityPercent != null)
    if (startDate) {
      filtered = filtered.filter((doc) => new Date(doc.uploadDate) >= new Date(startDate))
    }
    if (endDate) {
      filtered = filtered.filter((doc) => new Date(doc.uploadDate) <= new Date(endDate))
    }
    if (statuses.length > 0) {
      filtered = filtered.filter((doc) => statuses.includes(doc.status))
    }
    if (categories.length > 0) {
      filtered = filtered.filter((doc) => categories.includes(doc.category || "uncategorized"))
    }

    const byDateCategory = new Map<string, Map<string, number[]>>()
    filtered.forEach((doc) => {
      const dateStr = doc.uploadDate.split("T")[0]
      const cat = doc.category || "uncategorized"
      if (!byDateCategory.has(dateStr)) byDateCategory.set(dateStr, new Map())
      const catMap = byDateCategory.get(dateStr)!
      if (!catMap.has(cat)) catMap.set(cat, [])
      catMap.get(cat)!.push(doc.originalityPercent!)
    })
    const sortedDates = [...byDateCategory.keys()].sort()
    const categoryKeys = ["diploma", "coursework", "lab", "practice", "uncategorized"]
    const ranges = sortedDates.map((dateStr) => {
      const [y, m, d] = dateStr.split("-").map(Number)
      const formattedDate = `${d}.${m < 10 ? "0" + m : m}` // DD.MM
      const row: Record<string, string | number | null> = { date: dateStr, formattedDate }
      categoryKeys.forEach((cat) => {
        const vals = byDateCategory.get(dateStr)?.get(cat) ?? []
        row[cat] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null
      })
      return row
    })

    return NextResponse.json({
      success: true,
      ranges,
    })
  } catch (error) {
    console.error("Error fetching originality by date:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch" }, { status: 500 })
  }
}
