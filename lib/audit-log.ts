/**
 * Audit trail in PostgreSQL (table audit_logs).
 * File logs (lib/logger.ts) remain for debugging; important actions are duplicated here.
 */

import { prisma } from "./prisma"

export type AuditLevel = "info" | "warning" | "error" | "debug"

export interface AuditLogView {
  timestamp: string
  date: string
  level: string
  module: string
  message: string
  source: string
  action: string
  userId?: string
  entityType?: string
  entityId?: string
}

function actionToModule(action: string): string {
  if (action === "login" || action === "logout" || action === "register") return "auth"
  if (action === "upload" || action === "delete") return "upload"
  if (action === "check") return "scan"
  if (action === "report") return "report"
  if (action.startsWith("admin")) return "api"
  return "system"
}

function levelToUi(level: AuditLevel): string {
  if (level === "error") return "ERROR"
  if (level === "warning") return "WARN"
  if (level === "debug") return "DEBUG"
  return "INFO"
}

export async function writeAuditLog(entry: {
  userId?: string
  action: string
  level?: AuditLevel
  message: string
  entityType?: string
  entityId?: string
  details?: Record<string, unknown>
  ipAddress?: string
}): Promise<void> {
  try {
    // audit_logs.user_id FK → users.username. LDAP logs often fire before the
    // local user row exists (or on failed login); keep the event, drop the FK.
    let userId: string | null = entry.userId?.trim() || null
    const details: Record<string, unknown> = {
      level: entry.level ?? "info",
      message: entry.message,
      ...entry.details,
    }
    if (userId) {
      const exists = await prisma.user.findUnique({
        where: { username: userId },
        select: { username: true },
      })
      if (!exists) {
        details.username = userId
        userId = null
      }
    }

    await prisma.auditLog.create({
      data: {
        userId,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        details: JSON.stringify(details),
        ipAddress: entry.ipAddress ?? null,
      },
    })
  } catch (err) {
    console.error("Failed to write audit log:", err)
  }
}

/** Delete audit rows older than `retentionDays` (default from AUDIT_LOG_RETENTION_DAYS or 30). */
export async function purgeOldAuditLogs(retentionDays?: number): Promise<number> {
  const raw = retentionDays ?? Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "30", 10)
  const days = Number.isFinite(raw) ? Math.min(3650, Math.max(1, raw)) : 30
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}

export async function getAuditLogs(opts?: {
  limit?: number
  level?: AuditLevel
}): Promise<AuditLogView[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 1000, 1), 5000)
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  const out: AuditLogView[] = []
  for (const row of rows) {
    let parsed: { level?: AuditLevel; message?: string } = {}
    if (row.details) {
      try {
        parsed = JSON.parse(row.details)
      } catch {
        parsed = { message: row.details }
      }
    }
    const level = (parsed.level ?? "info") as AuditLevel
    if (opts?.level && level !== opts.level) continue

    out.push({
      timestamp: row.createdAt.toISOString(),
      date: row.createdAt.toISOString().slice(0, 10),
      level: levelToUi(level),
      module: actionToModule(row.action),
      message: parsed.message || row.action,
      source: row.userId || row.ipAddress || "system",
      action: row.action,
      userId: row.userId ?? undefined,
      entityType: row.entityType ?? undefined,
      entityId: row.entityId ?? undefined,
    })
  }
  return out
}
