/**
 * Общая логика GET /api/report/verify (+ путь без query для QR).
 * Параметр sig из QR должен быть `sig`, но при ошибке HTML-сущности в ссылке
 * браузер даёт второй параметр с именем `amp;sig` — обрабатываем и это.
 */

import { NextResponse } from "next/server"
import { getDocumentByIdFromDb, getReportPdfPath, getDocumentAuthorLabel } from "@/lib/local-storage"
import { verifyDocumentAccess } from "@/lib/report-access"

/** Извлекает подпись из query; учитывает битые ссылки вида …?documentId=1&amp;sig=… */
export function getQrSignature(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("sig")
  if (raw) return raw
  const malformed = searchParams.get("amp;sig")
  if (malformed) return malformed
  const encodedName = searchParams.get("amp%3Bsig")
  return encodedName
}

/** Сегмент path из QR (может быть percent-encoded). */
export function decodePathSegmentSig(sigRaw: string | null | undefined): string | null {
  let sig: string | null = sigRaw || null
  if (sig && sig.includes("%")) {
    try {
      sig = decodeURIComponent(sig)
    } catch {
      /* оставляем как есть */
    }
  }
  return sig
}

export async function reportVerifyResponse(
  documentIdNum: number,
  sig: string | null,
  rawJson: boolean,
): Promise<NextResponse> {
  if (Number.isNaN(documentIdNum)) {
    return NextResponse.json({ success: false, error: "Некорректный documentId" }, { status: 400 })
  }
  if (!sig || !verifyDocumentAccess("report", documentIdNum, sig)) {
    return NextResponse.json(
      { success: false, error: "Доступ запрещён. Используйте ссылку из QR-кода на справке." },
      { status: 403 },
    )
  }

  const doc = await getDocumentByIdFromDb(documentIdNum)
  if (!doc) {
    return NextResponse.json(
      { success: false, error: "Документ не найден в локальном хранилище" },
      { status: 404 },
    )
  }

  const reportExists = !!getReportPdfPath(documentIdNum)
  const authorLabel = getDocumentAuthorLabel(doc)

  const payload = {
    success: true,
    documentId: doc.id,
    title: doc.title,
    author: authorLabel,
    username: doc.userId ?? null,
    institution: doc.institution ?? "БГУИР",
    status: doc.status,
    uploadDate: doc.uploadDate,
    reportStored: reportExists,
    verifiedAt: new Date().toISOString(),
  }

  if (rawJson) {
    return NextResponse.json(payload)
  }

  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Верификация справки</title></head><body style="font-family:system-ui;max-width:480px;margin:2rem auto;padding:1rem;"><h1>Проверка подлинности справки</h1><p>Документ №${doc.id} — <strong>${doc.title ?? "—"}</strong></p><p>Автор: ${authorLabel}</p><p>Дата загрузки: ${doc.uploadDate ? new Date(doc.uploadDate).toLocaleString("ru-RU") : "—"}</p><p>Отчёт в хранилище: ${reportExists ? "да" : "нет"}</p>${reportExists ? `<p><a href="/api/report/${doc.id}/view?sig=${encodeURIComponent(sig!)}">Открыть PDF справки</a></p>` : ""}<p style="color:#666;font-size:0.9rem;">Верификация выполнена в системе БГУИР.ПЛАГИАТ.</p></body></html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  )
}
