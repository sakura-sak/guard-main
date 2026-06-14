import { type NextRequest, NextResponse } from "next/server"
import { getLogs } from "@/lib/logger"
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

const CATEGORY_KEYS = ["diploma", "coursework", "lab", "practice", "uncategorized"] as const

/**
 * GET /api/admin/statistics/processing-time-ranges
 * Суммарное время обработки по диапазонам оригинальности, разбивка по типу работы.
 * Параметры: year (обязательный), status (draft,final или пусто = все),
 *            category (diploma,coursework,lab,practice,uncategorized или пусто = все)
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

    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : []
    const categories = categoryParam ? categoryParam.split(",").map((c) => c.trim()).filter(Boolean) : []

    const logs = getLogs()
    const checkLogs = logs.filter((log) => {
      if (log.action !== "check") return false
      const ts = new Date(log.timestamp)
      if (Number.isNaN(ts.getTime()) || ts.getFullYear() !== year) return false

      const metadata = log.metadata ?? {}
      const status = String(metadata.status || "draft")
      const category = String(metadata.category || "uncategorized")

      if (statuses.length > 0 && !statuses.includes(status)) return false
      if (categories.length > 0 && !categories.includes(category)) return false
      return true
    })

    const byRangeCategory = new Map<string, Map<string, number>>()
    RANGES.forEach((r) => {
      byRangeCategory.set(r.key, new Map())
      CATEGORY_KEYS.forEach((c) => byRangeCategory.get(r.key)!.set(c, 0))
    })

    checkLogs.forEach((log) => {
      const metadata = log.metadata ?? {}
      const uniquenessPercent = Number(metadata.uniquenessPercent)
      const processingTimeMs = Number(metadata.processingTimeMs)
      if (!Number.isFinite(uniquenessPercent) || !Number.isFinite(processingTimeMs)) return

      const range = RANGES.find((r) => uniquenessPercent >= r.min && uniquenessPercent <= r.max)
      if (!range) return

      const rawCategory = String(metadata.category || "uncategorized")
      const category = CATEGORY_KEYS.includes(rawCategory as (typeof CATEGORY_KEYS)[number])
        ? rawCategory
        : "uncategorized"

      const seconds = processingTimeMs / 1000
      const map = byRangeCategory.get(range.key)!
      map.set(category, (map.get(category) ?? 0) + seconds)
    })

    const rangesData = RANGES.map((r) => {
      const catMap = byRangeCategory.get(r.key)!
      return {
        rangeKey: r.key,
        rangeLabel: r.label,
        diploma: Math.round((catMap.get("diploma") ?? 0) * 100) / 100,
        coursework: Math.round((catMap.get("coursework") ?? 0) * 100) / 100,
        lab: Math.round((catMap.get("lab") ?? 0) * 100) / 100,
        practice: Math.round((catMap.get("practice") ?? 0) * 100) / 100,
        uncategorized: Math.round((catMap.get("uncategorized") ?? 0) * 100) / 100,
      }
    })

    return NextResponse.json({
      success: true,
      year,
      ranges: rangesData,
    })
  } catch (error) {
    console.error("Error fetching processing time ranges:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch processing time ranges" }, { status: 500 })
  }
}
