/**
 * Система логирования для сбора данных об ошибках и действиях пользователей
 */

import fs from "fs"
import path from "path"
import { writeAuditLog, type AuditLevel } from "./audit-log"

export type LogLevel = "info" | "warning" | "error" | "debug"

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  userId?: string
  userRole?: string
  action?: string
  error?: string
  metadata?: Record<string, any>
}

const LOGS_DIR = path.join(process.cwd(), "data", "logs")
const LOG_FILE = path.join(LOGS_DIR, `app-${new Date().toISOString().split("T")[0]}.log`)

// Инициализация директории логов
function ensureLogsDirectory() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
  }
}

// Запись лога в файл
function writeLog(entry: LogEntry) {
  try {
    ensureLogsDirectory()
    const logLine = JSON.stringify(entry) + "\n"
    fs.appendFileSync(LOG_FILE, logLine, "utf-8")
  } catch (error) {
    console.error("Failed to write log:", error)
  }
}

function mirrorToAudit(entry: LogEntry) {
  if (!entry.action) return
  const level: AuditLevel =
    entry.level === "warning" ? "warning" : entry.level === "error" ? "error" : entry.level === "debug" ? "debug" : "info"
  void writeAuditLog({
    userId: entry.userId,
    action: entry.action,
    level,
    message: entry.message,
    details: {
      userRole: entry.userRole,
      error: entry.error,
      ...entry.metadata,
    },
  })
}

// Логирование информации
export function logInfo(message: string, userId?: string, userRole?: string, action?: string, metadata?: Record<string, any>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "info",
    message,
    userId,
    userRole,
    action,
    metadata,
  }
  writeLog(entry)
  mirrorToAudit(entry)
  console.log(`[INFO] ${message}`, metadata || "")
}

// Логирование предупреждений
export function logWarning(message: string, userId?: string, userRole?: string, action?: string, metadata?: Record<string, any>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "warning",
    message,
    userId,
    userRole,
    action,
    metadata,
  }
  writeLog(entry)
  mirrorToAudit(entry)
  console.warn(`[WARNING] ${message}`, metadata || "")
}

// Логирование ошибок
export function logError(
  message: string,
  error?: Error | string,
  userId?: string,
  userRole?: string,
  action?: string,
  metadata?: Record<string, any>,
) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "error",
    message,
    userId,
    userRole,
    action,
    error: error instanceof Error ? error.message : error,
    metadata: {
      ...metadata,
      stack: error instanceof Error ? error.stack : undefined,
    },
  }
  writeLog(entry)
  mirrorToAudit(entry)
  console.error(`[ERROR] ${message}`, error, metadata || "")
}

// Логирование отладки
export function logDebug(message: string, userId?: string, userRole?: string, action?: string, metadata?: Record<string, any>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: "debug",
    message,
    userId,
    userRole,
    action,
    metadata,
  }
  writeLog(entry)
  if (process.env.NODE_ENV === "development") {
    console.debug(`[DEBUG] ${message}`, metadata || "")
  }
}

// Получение логов за период
export function getLogs(startDate?: Date, endDate?: Date, level?: LogLevel): LogEntry[] {
  try {
    ensureLogsDirectory()
    const logs: LogEntry[] = []

    // Читаем все файлы логов
    const files = fs.readdirSync(LOGS_DIR).filter((file) => file.startsWith("app-") && file.endsWith(".log"))

    for (const file of files) {
      const filePath = path.join(LOGS_DIR, file)
      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim())

      for (const line of lines) {
        try {
          const entry: LogEntry = JSON.parse(line)
          const entryDate = new Date(entry.timestamp)

          // Фильтрация по дате
          if (startDate && entryDate < startDate) continue
          if (endDate && entryDate > endDate) continue
          if (level && entry.level !== level) continue

          logs.push(entry)
        } catch (err) {
          // Пропускаем некорректные строки
        }
      }
    }

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  } catch (error) {
    console.error("Failed to read logs:", error)
    return []
  }
}

// Статистика ошибок
export function getErrorStats(startDate?: Date, endDate?: Date) {
  const logs = getLogs(startDate, endDate, "error")
  return {
    totalErrors: logs.length,
    errorsByAction: logs.reduce((acc, log) => {
      const action = log.action || "unknown"
      acc[action] = (acc[action] || 0) + 1
      return acc
    }, {} as Record<string, number>),
    recentErrors: logs.slice(0, 10),
  }
}
