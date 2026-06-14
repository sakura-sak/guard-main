/**
 * Краткое сообщение для клиента по ошибке Prisma (без утечки внутренних деталей в проде).
 */
export function prismaClientMessage(err: unknown): string | null {
  if (!err || typeof err !== "object") return null
  const code = (err as { code?: string }).code
  if (!code || typeof code !== "string") return null

  const messages: Record<string, string> = {
    P1001:
      "Нет соединения с сервером базы данных. Для Docker задайте DATABASE_URL на хост СУБД (например postgresql://…@db:5432/…).",
    P1003: "База данных недоступна или указана несуществующая в connection string.",
    P1017: "Сервер базы данных закрыл соединение.",
    P2002: "Конфликт уникальности записи в базе.",
    P2025: "Запись для обновления не найдена.",
  }
  return messages[code] ?? null
}

export function formatApiUploadError(err: unknown): string {
  const prismaMsg = prismaClientMessage(err)
  if (prismaMsg) return prismaMsg

  if (err instanceof Error) {
    const m = err.message
    if (/request entity too large|body.?size|payload too large|413/i.test(m)) {
      return "Запрос слишком большой (файл и текст вместе). Уменьшите размер файла или проверьте лимиты nginx (client_max_body_size)."
    }
    if (/aborted|timeout|ETIMEDOUT|ECONNRESET/i.test(m)) {
      return "Таймаут или обрыв при передаче файла. Повторите попытку."
    }
    if (process.env.NODE_ENV !== "production") {
      return m.slice(0, 500)
    }
  }
  return "Ошибка при загрузке файла"
}
