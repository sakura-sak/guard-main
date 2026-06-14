import { type NextRequest, NextResponse } from "next/server"
import { getAuditLogs, type AuditLevel } from "@/lib/audit-log"
import { getLogs } from "@/lib/logger"
import { requireAdminApi } from "@/lib/require-admin-api"

// GET - Получение логов (PostgreSQL audit_logs + файловые логи как fallback)
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  try {
    const { searchParams } = new URL(request.url)
    const levelParam = searchParams.get("level") as "info" | "warning" | "error" | "debug" | null
    const auditLevel: AuditLevel | undefined =
      levelParam === "error" || levelParam === "warning" || levelParam === "debug" || levelParam === "info"
        ? levelParam
        : undefined

    let logs = await getAuditLogs({ limit: 1000, level: auditLevel })

    // Если audit_logs пуст (старые установки), показываем файловые логи
    if (logs.length === 0) {
      const fileLevel =
        levelParam === "error" || levelParam === "warning" || levelParam === "debug" || levelParam === "info"
          ? levelParam
          : undefined
      const fileLogs = getLogs(undefined, undefined, fileLevel)
      logs = fileLogs.slice(0, 1000).map((l) => ({
        timestamp: l.timestamp,
        date: l.timestamp.slice(0, 10),
        level:
          l.level === "error" ? "ERROR" : l.level === "warning" ? "WARN" : l.level === "debug" ? "DEBUG" : "INFO",
        module: l.action || "system",
        message: l.message,
        source: l.userId || "system",
        action: l.action || "system",
        userId: l.userId,
      }))
    }

    return NextResponse.json({
      success: true,
      logs,
    })
  } catch (error) {
    console.error("Error fetching logs:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch logs" }, { status: 500 })
  }
}
