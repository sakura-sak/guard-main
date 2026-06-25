import { type NextRequest, NextResponse } from "next/server"
import { getAllDocumentsFromDb } from "@/lib/local-storage"
import { getLogs } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"
import { getAllDocumentTypes } from "@/lib/document-types"
import { categoryLabel as staticCategoryLabel } from "@/lib/category-labels"
function roundPercent(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

function plagiarismFromDoc(originalityPercent: number | null | undefined, plagiarismPercentMl: number | null | undefined): number {
  if (typeof originalityPercent === "number" && Number.isFinite(originalityPercent)) {
    return roundPercent(100 - originalityPercent)
  }
  if (typeof plagiarismPercentMl === "number" && Number.isFinite(plagiarismPercentMl)) {
    return roundPercent(plagiarismPercentMl)
  }
  return 0
}

// GET — статистика для мониторинга (дашборд админки)
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("startDate") || searchParams.get("from")
    const endDate = searchParams.get("endDate") || searchParams.get("to")
    const categoryParam = searchParams.get("category") || ""
    const statusParam = searchParams.get("status") || ""
    const categories = categoryParam ? categoryParam.split(",").map((c) => c.trim()).filter(Boolean) : []
    const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : []
    const minUniqueness = Number.parseInt(searchParams.get("minUniqueness") || "0", 10)
    const maxUniqueness = Number.parseInt(searchParams.get("maxUniqueness") || "100", 10)
    const minPlagiarism = Number.parseInt(searchParams.get("minPlagiarism") || "0", 10)
    const maxPlagiarism = Number.parseInt(searchParams.get("maxPlagiarism") || "100", 10)

    const institutionScope = gate.isUniversityAdmin ? gate.institutionId ?? undefined : undefined
    const allDocuments = await getAllDocumentsFromDb(undefined, institutionScope)
    const docTypes = await getAllDocumentTypes(true)
    const labelByCategory = Object.fromEntries(docTypes.map((t) => [t.name, t.displayName]))

    let filteredDocs = allDocuments
    if (startDate) {
      filteredDocs = filteredDocs.filter((doc) => new Date(doc.uploadDate) >= new Date(startDate))
    }
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      filteredDocs = filteredDocs.filter((doc) => new Date(doc.uploadDate) <= end)
    }
    if (categories.length > 0) {
      filteredDocs = filteredDocs.filter((doc) => categories.includes(doc.category || "uncategorized"))
    }
    if (statuses.length > 0) {
      filteredDocs = filteredDocs.filter((doc) => statuses.includes(doc.status))
    }
    filteredDocs = filteredDocs.filter((doc) => {
      const orig = doc.originalityPercent ?? null
      const plag = plagiarismFromDoc(doc.originalityPercent, doc.plagiarismPercentMl)
      if (orig !== null) {
        if (orig < minUniqueness || orig > maxUniqueness) return false
      }
      if (plag > 0 && (plag < minPlagiarism || plag > maxPlagiarism)) return false
      return true
    })

    const logs = getLogs(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    )
    const checkLogs = logs.filter((log) => log.action === "check")
    const totalChecks = checkLogs.length

    const categoryCounts = new Map<string, number>()
    filteredDocs.forEach((doc) => {
      const cat = doc.category || "uncategorized"
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
    })

    const checksByCategory = Array.from(categoryCounts.entries()).map(([category, count]) => ({
      category,
      categoryLabel: labelByCategory[category] ?? staticCategoryLabel(category),
      count,
    }))

    const dateCounts = new Map<string, number>()
    filteredDocs.forEach((doc) => {
      const date = doc.uploadDate.split("T")[0]
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1)
    })

    const uploadsByDate = Array.from(dateCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const checkLogsByDate = new Map<string, number>()
    checkLogs.forEach((log) => {
      const date = new Date(log.timestamp).toISOString().split("T")[0]
      checkLogsByDate.set(date, (checkLogsByDate.get(date) || 0) + 1)
    })
    const checksByDate = Array.from(checkLogsByDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)

    const uniquenessRanges = [
      { range: "0-20%", min: 0, max: 20 },
      { range: "21-40%", min: 21, max: 40 },
      { range: "41-60%", min: 41, max: 60 },
      { range: "61-80%", min: 61, max: 80 },
      { range: "81-100%", min: 81, max: 100 },
    ]

    const withOrig = filteredDocs.filter((d) => typeof d.originalityPercent === "number")
    const uniquenessDistribution = uniquenessRanges.map((range) => ({
      range: range.range,
      count: withOrig.filter((d) => {
        const o = d.originalityPercent!
        return o >= range.min && o <= range.max
      }).length,
    }))

    const averageUniqueness =
      withOrig.length > 0
        ? roundPercent(withOrig.reduce((s, d) => s + (d.originalityPercent ?? 0), 0) / withOrig.length)
        : 0

    const userActivity = new Map<string, number>()
    checkLogs.forEach((log) => {
      if (log.userId) {
        userActivity.set(log.userId, (userActivity.get(log.userId) || 0) + 1)
      }
    })
    filteredDocs.forEach((doc) => {
      if (doc.userId) {
        userActivity.set(doc.userId, (userActivity.get(doc.userId) || 0) + 1)
      }
    })

    const topUsers = Array.from(userActivity.entries())
      .map(([username, checks]) => ({ username, checks }))
      .sort((a, b) => b.checks - a.checks)
      .slice(0, 10)

    const finals = filteredDocs.filter((d) => d.status === "final")
    const finalsWithOrig = finals.filter((d) => typeof d.originalityPercent === "number")
    const finalsWithAi = finals.filter((d) => typeof d.aiPercentMl === "number")

    const summary = {
      totalDocuments: filteredDocs.length,
      uniqueUsers: new Set(filteredDocs.map((d) => d.userId).filter(Boolean)).size,
      drafts: filteredDocs.filter((d) => d.status === "draft").length,
      archived: filteredDocs.filter((d) => d.status === "archived").length,
      finals: finals.length,
      averageUniqueness:
        finalsWithOrig.length > 0
          ? roundPercent(finalsWithOrig.reduce((s, d) => s + (d.originalityPercent ?? 0), 0) / finalsWithOrig.length)
          : averageUniqueness,
      averageAi:
        finalsWithAi.length > 0
          ? roundPercent(finalsWithAi.reduce((s, d) => s + (d.aiPercentMl ?? 0), 0) / finalsWithAi.length)
          : 0,
      totalChecks,
    }

    const finalsByCategory = docTypes.map((t) => ({
      category: t.name,
      categoryLabel: t.displayName,
      count: finals.filter((d) => d.category === t.name).length,
    }))

    const dashboardDocuments = filteredDocs.map((doc) => {
      const typeLabel = labelByCategory[doc.category] ?? staticCategoryLabel(doc.category)
      const percent =
        typeof doc.originalityPercent === "number" ? roundPercent(doc.originalityPercent) : 0
      const matches = plagiarismFromDoc(doc.originalityPercent, doc.plagiarismPercentMl)
      const ai = typeof doc.aiPercentMl === "number" ? roundPercent(doc.aiPercentMl) : 0
      return {
        id: doc.id,
        docId: String(doc.id),
        userId: doc.userId ?? null,
        title: doc.title,
        author: doc.author,
        category: doc.category,
        type: typeLabel,
        categoryLabel: typeLabel,
        status: doc.status,
        percent,
        originalityPercent: percent,
        matches,
        plagiarismPercent: matches,
        ai,
        aiPercent: ai,
        date: doc.uploadDate.split("T")[0],
        uploadDate: doc.uploadDate,
        uo: doc.institution ?? null,
        institution: doc.institution ?? null,
        faculty: doc.faculty ?? null,
      }
    })

    const byDateCategory = new Map<string, Map<string, number[]>>()
    filteredDocs.forEach((doc) => {
      if (doc.originalityPercent == null) return
      const dateStr = doc.uploadDate.split("T")[0]
      const cat = doc.category || "uncategorized"
      if (!byDateCategory.has(dateStr)) byDateCategory.set(dateStr, new Map())
      const catMap = byDateCategory.get(dateStr)!
      if (!catMap.has(cat)) catMap.set(cat, [])
      catMap.get(cat)!.push(doc.originalityPercent)
    })

    const sortedDates = [...byDateCategory.keys()].sort()
    const categoryKeys = docTypes.map((t) => t.name)
    const originalityByDateByCategory = sortedDates.map((dateStr) => {
      const [y, m, d] = dateStr.split("-").map(Number)
      const formattedDate = `${d}.${m < 10 ? "0" + m : m}`
      const row: Record<string, string | number | null> = { date: dateStr, formattedDate }
      categoryKeys.forEach((cat) => {
        const vals = byDateCategory.get(dateStr)?.get(cat) ?? []
        row[cat] = vals.length ? roundPercent(vals.reduce((a, b) => a + b, 0) / vals.length) : null
      })
      return row
    })

    const statistics = {
      totalChecks,
      totalDocuments: filteredDocs.length,
      averageUniqueness,
      checksByCategory,
      checksByDate,
      uploadsByDate,
      uniquenessDistribution,
      userActivity: topUsers,
      documents: dashboardDocuments.map((d) => ({
        id: d.id,
        userId: d.userId,
        category: d.category,
        status: d.status,
        originalityPercent: d.percent,
        plagiarismPercent: d.matches,
        uploadDate: d.uploadDate,
      })),
      dashboardDocuments,
      summary,
      finalsByCategory,
      originalityByDateByCategory,
    }

    return NextResponse.json({ success: true, statistics })
  } catch (error) {
    console.error("Error fetching statistics:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch statistics" }, { status: 500 })
  }
}
