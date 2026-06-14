import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { getLogs } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"

// GET - Получение статистики
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const categoryParam = searchParams.get("category") || ""
    const statusParam = searchParams.get("status") || ""
    const categories = categoryParam ? categoryParam.split(",").map((c) => c.trim()).filter(Boolean) : []
    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : []
    const minUniqueness = Number.parseInt(searchParams.get("minUniqueness") || "0")
    const maxUniqueness = Number.parseInt(searchParams.get("maxUniqueness") || "100")
    const minPlagiarism = Number.parseInt(searchParams.get("minPlagiarism") || "0")
    const maxPlagiarism = Number.parseInt(searchParams.get("maxPlagiarism") || "100")

    const documents = await getAllDocumentsFromDb()
    const logs = getLogs(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    )

    // Фильтруем документы для таблицы и сводной статистики (множественный выбор: тип работы, статус)
    let filteredDocs = documents
    if (startDate) {
      filteredDocs = filteredDocs.filter((doc) => new Date(doc.uploadDate) >= new Date(startDate))
    }
    if (endDate) {
      filteredDocs = filteredDocs.filter((doc) => new Date(doc.uploadDate) <= new Date(endDate))
    }
    if (categories.length > 0) {
      filteredDocs = filteredDocs.filter((doc) => categories.includes(doc.category || "uncategorized"))
    }
    if (statuses.length > 0) {
      filteredDocs = filteredDocs.filter((doc) => statuses.includes(doc.status))
    }
    filteredDocs = filteredDocs.filter((doc) => {
      const orig = doc.originalityPercent ?? null
      if (orig !== null) {
        if (orig < minUniqueness || orig > maxUniqueness) return false
      }
      const plag = orig !== null ? 100 - orig : null
      if (plag !== null && (plag < minPlagiarism || plag > maxPlagiarism)) return false
      return true
    })

    // Подсчитываем проверки из логов
    const checkLogs = logs.filter((log) => log.action === "check")
    const totalChecks = checkLogs.length

    // Статистика по категориям
    const categoryCounts = new Map<string, number>()
    filteredDocs.forEach((doc) => {
      const cat = doc.category || "uncategorized"
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    })

    const checksByCategory = Array.from(categoryCounts.entries()).map(([category, count]) => ({
      category,
      count,
    }))

    // Статистика по датам
    const dateCounts = new Map<string, number>()
    checkLogs.forEach((log) => {
      const date = new Date(log.timestamp).toISOString().split("T")[0]
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1)
    })

    const checksByDate = Array.from(dateCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30) // Последние 30 дней

    // Распределение уникальности (упрощенная версия)
    const uniquenessRanges = [
      { range: "0-20%", min: 0, max: 20 },
      { range: "21-40%", min: 21, max: 40 },
      { range: "41-60%", min: 41, max: 60 },
      { range: "61-80%", min: 61, max: 80 },
      { range: "81-100%", min: 81, max: 100 },
    ]

    const uniquenessDistribution = uniquenessRanges.map((range) => ({
      range: range.range,
      count: Math.floor(Math.random() * 10), // TODO: Реальная статистика из результатов проверок
    }))

    // Активность пользователей
    const userActivity = new Map<string, number>()
    checkLogs.forEach((log) => {
      if (log.userId) {
        userActivity.set(log.userId, (userActivity.get(log.userId) || 0) + 1)
      }
    })

    const topUsers = Array.from(userActivity.entries())
      .map(([username, checks]) => ({ username, checks }))
      .sort((a, b) => b.checks - a.checks)
      .slice(0, 10)

    // Средняя уникальность (упрощенная версия)
    const averageUniqueness = 75.5 // TODO: Реальная статистика из результатов проверок

    const documentsTable = filteredDocs.map((doc) => {
      const originalityPercent = doc.originalityPercent ?? null
      const plagiarismPercent = originalityPercent !== null ? 100 - originalityPercent : null
      return {
        id: doc.id,
        userId: doc.userId ?? null,
        category: doc.category,
        status: doc.status,
        originalityPercent,
        plagiarismPercent,
        uploadDate: doc.uploadDate,
      }
    })

    // График 3: процент оригинальности по датам, по типам работ (только фильтры дата + статус)
    let docsForLineChart = documents
    if (startDate) {
      docsForLineChart = docsForLineChart.filter((doc) => new Date(doc.uploadDate) >= new Date(startDate))
    }
    if (endDate) {
      docsForLineChart = docsForLineChart.filter((doc) => new Date(doc.uploadDate) <= new Date(endDate))
    }
    if (statuses.length > 0) {
      docsForLineChart = docsForLineChart.filter((doc) => statuses.includes(doc.status))
    }
    if (categories.length > 0) {
      docsForLineChart = docsForLineChart.filter((doc) => categories.includes(doc.category || "uncategorized"))
    }
    const byDateCategory = new Map<string, Map<string, number[]>>()
    docsForLineChart.forEach((doc) => {
      if (doc.originalityPercent == null) return
      const dateStr = doc.uploadDate.split("T")[0]
      const cat = doc.category || "uncategorized"
      if (!byDateCategory.has(dateStr)) byDateCategory.set(dateStr, new Map())
      const catMap = byDateCategory.get(dateStr)!
      if (!catMap.has(cat)) catMap.set(cat, [])
      catMap.get(cat)!.push(doc.originalityPercent)
    })
    const sortedDates = [...byDateCategory.keys()].sort()
    const categoryKeys = ["diploma", "coursework", "lab", "practice", "uncategorized"]
    const originalityByDateByCategory = sortedDates.map((dateStr) => {
      const [y, m, d] = dateStr.split("-").map(Number)
      const formattedDate = `${d}.${m < 10 ? "0" + m : m}` // DD.MM
      const row: Record<string, string | number | null> = { date: dateStr, formattedDate }
      categoryKeys.forEach((cat) => {
        const vals = byDateCategory.get(dateStr)?.get(cat) ?? []
        row[cat] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null
      })
      return row
    })

    const statistics = {
      totalChecks,
      totalDocuments: filteredDocs.length,
      averageUniqueness,
      checksByCategory,
      checksByDate,
      uniquenessDistribution,
      userActivity: topUsers,
      documents: documentsTable,
      originalityByDateByCategory,
    }

    return NextResponse.json({
      success: true,
      statistics,
    })
  } catch (error) {
    console.error("Error fetching statistics:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch statistics" }, { status: 500 })
  }
}
