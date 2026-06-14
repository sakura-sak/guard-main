import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

const RANGES = [
  { key: "0-10", label: "0-10", min: 0, max: 10 },
  { key: "11-20", label: "11-20", min: 11, max: 20 },
  { key: "21-30", label: "21-30", min: 21, max: 30 },
  { key: "31-40", label: "31-40", min: 31, max: 40 },
  { key: "41-50", label: "41-50", min: 41, max: 50 },
  { key: "51-60", label: "51-60", min: 51, max: 60 },
  { key: "61-70", label: "61-70", min: 61, max: 70 },
  { key: "71-80", label: "71-80", min: 71, max: 80 },
  { key: "81-90", label: "81-90", min: 81, max: 90 },
  { key: "91-100", label: "91-100", min: 91, max: 100 },
]

/**
 * GET /api/admin/statistics/originality-ranges
 * Количество загрузок по диапазонам процента оригинальности, разбивка по типу работы.
 * Параметры: year (обязательный), status (через запятую: draft,final или пусто = все),
 *            category (через запятую: diploma,coursework,lab,practice или пусто = все)
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

    let filtered = documents.filter((doc) => {
      const d = new Date(doc.uploadDate)
      if (d.getFullYear() !== year) return false
      if (doc.originalityPercent == null) return false
      if (statuses.length > 0 && !statuses.includes(doc.status)) return false
      const cat = doc.category || "uncategorized"
      if (categories.length > 0 && !categories.includes(cat)) return false
      return true
    })

    const byRangeCategory = new Map<string, Map<string, number>>()
    RANGES.forEach((r) => {
      byRangeCategory.set(r.key, new Map())
      ;["diploma", "coursework", "lab", "practice", "uncategorized"].forEach((c) =>
        byRangeCategory.get(r.key)!.set(c, 0),
      )
    })

    filtered.forEach((doc) => {
      const orig = doc.originalityPercent!
      const range = RANGES.find((r) => orig >= r.min && orig <= r.max)
      if (!range) return
      const cat = doc.category || "uncategorized"
      const map = byRangeCategory.get(range.key)!
      map.set(cat, (map.get(cat) ?? 0) + 1)
    })

    const rangesData = RANGES.map((r) => {
      const catMap = byRangeCategory.get(r.key)!
      return {
        rangeKey: r.key,
        rangeLabel: r.label,
        diploma: catMap.get("diploma") ?? 0,
        coursework: catMap.get("coursework") ?? 0,
        lab: catMap.get("lab") ?? 0,
        practice: catMap.get("practice") ?? 0,
        uncategorized: catMap.get("uncategorized") ?? 0,
      }
    })

    return NextResponse.json({
      success: true,
      year,
      ranges: rangesData,
    })
  } catch (error) {
    console.error("Error fetching originality ranges:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch originality ranges" }, { status: 500 })
  }
}
