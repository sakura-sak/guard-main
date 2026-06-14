import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { requireAdminApi } from "@/lib/require-admin-api"

const MONTH_LABELS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]

/**
 * GET /api/admin/statistics/monthly-uploads
 * Количество загрузок по месяцам года, разбивка по типу работы.
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

    const byMonthCategory = new Map<number, Map<string, number>>()
    for (let m = 1; m <= 12; m++) {
      byMonthCategory.set(m, new Map())
      ;["diploma", "coursework", "lab", "practice", "uncategorized"].forEach((cat) =>
        byMonthCategory.get(m)!.set(cat, 0),
      )
    }

    filtered.forEach((doc) => {
      const d = new Date(doc.uploadDate)
      if (d.getFullYear() !== year) return
      const month = d.getMonth() + 1
      const cat = doc.category || "uncategorized"
      const map = byMonthCategory.get(month)!
      map.set(cat, (map.get(cat) ?? 0) + 1)
    })

    const monthly = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      const catMap = byMonthCategory.get(month)!
      return {
        month: month.toString().padStart(2, "0"),
        monthLabel: MONTH_LABELS[i],
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
      monthly,
    })
  } catch (error) {
    console.error("Error fetching monthly uploads:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch monthly uploads" }, { status: 500 })
  }
}
