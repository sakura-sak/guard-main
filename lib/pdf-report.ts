/**
 * Генерация PDF‑отчётов о проверке на плагиат.
 * Финальная версия (Сценарий Б): справка БГУИР с блоком верификации и двумя QR‑кодами.
 * Используется шрифт DejaVu Sans для корректного отображения кириллицы.
 */

// @ts-ignore - jsPDF может иметь проблемы с типами
import jsPDF from "jspdf"
// @ts-ignore - для qrcode может отсутствовать declaration file
import QRCode from "qrcode"
import fs from "fs"
import path from "path"
import { buildReportQrLinks } from "@/lib/report-qr-links"

const FONT = "DejaVu"

function loadDejaVuFonts(doc: jsPDF) {
  const base = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf")
  const regPath = path.join(base, "DejaVuSans.ttf")
  const boldPath = path.join(base, "DejaVuSans-Bold.ttf")
  if (!fs.existsSync(regPath) || !fs.existsSync(boldPath)) return
  try {
    const regBase64 = fs.readFileSync(regPath).toString("base64")
    const boldBase64 = fs.readFileSync(boldPath).toString("base64")
    doc.addFileToVFS("DejaVuSans.ttf", regBase64)
    doc.addFileToVFS("DejaVuSans-Bold.ttf", boldBase64)
    doc.addFont("DejaVuSans.ttf", FONT, "normal")
    doc.addFont("DejaVuSans-Bold.ttf", FONT, "bold")
  } catch (e) {
    console.error("Failed to load DejaVu fonts for PDF:", e)
  }
}

export interface SimilarDocumentForReport {
  id: number
  title: string
  author: string | null
  userId?: string | null
  similarity: number
  category: string
}

export interface CheckResultForReport {
  filename: string
  title?: string
  author?: string
  checker?: string
  category?: string
  uniquenessPercent: number
  citationPercent?: number
  totalDocumentsChecked: number
  similarDocuments: SimilarDocumentForReport[]
  processingTimeMs: number
  plagiarismPercentMl?: number
  aiPercentMl?: number
  uploadDate?: string
  status?: "draft" | "final"
  documentId?: number
  baseUrl?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  diploma: "Дипломная работа",
  coursework: "Курсовая работа / Проект",
  lab: "Лабораторная работа",
  practice: "Практическое задание",
  uncategorized: "Не указано",
}

function categoryLabel(cat?: string): string {
  if (!cat) return "Не указано"
  return CATEGORY_LABELS[cat] ?? cat
}

function formatDate(s?: string): string {
  if (!s) return new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
  return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Процент с запятой (32,06) */
function formatPercent(v: number): string {
  return v.toFixed(2).replace(".", ",")
}

/** Рисует блок шапки (логотип + университет) в левом верхнем углу */
function drawHeaderBlock(doc: jsPDF, margin: number, pageWidth: number): number {
  let y = margin
  const logoSize = 12
  const blue = [0.22, 0.45, 0.82] as [number, number, number]

  // Пытаемся загрузить логотип BSUIR (приоритет PNG, так как jsPDF лучше поддерживает PNG)
  let logoLoaded = false
  const possibleLogoPaths = [
    "bsuir-logo.png",
    "bsuir.png",
    "logo-bsuir.png",
    "bsuir-logo.svg",
    "bsuir.svg",
    "logo-bsuir.svg",
  ]

  for (const logoName of possibleLogoPaths) {
    try {
      const logoPath = path.join(process.cwd(), "public", logoName)
      if (fs.existsSync(logoPath)) {
        const img = fs.readFileSync(logoPath)
        if (logoName.endsWith(".png")) {
          const base64 = `data:image/png;base64,${img.toString("base64")}`
          doc.addImage(base64, "PNG", margin, y, logoSize, logoSize)
          logoLoaded = true
          break
        }
        // SVG может не работать напрямую в jsPDF, но попробуем
        else if (logoName.endsWith(".svg")) {
          try {
            const base64 = `data:image/svg+xml;base64,${img.toString("base64")}`
            doc.addImage(base64, "SVG", margin, y, logoSize, logoSize)
            logoLoaded = true
            break
          } catch {
            // SVG не поддерживается, продолжаем поиск
          }
        }
      }
    } catch (e) {
      // Продолжаем поиск следующего файла
    }
  }

  // Если логотип не найден, используем fallback - синий квадрат
  if (!logoLoaded) {
    doc.setFillColor(blue[0] * 255, blue[1] * 255, blue[2] * 255)
    doc.rect(margin, y, logoSize, logoSize, "F")
  }

  doc.setFontSize(9)
  doc.setFont(FONT, "normal")
  doc.setTextColor(0, 0, 0)

  const textX = margin + logoSize + 4
  const lineHeight = 4
  const uniLine1 = "Белорусский государственный университет"
  const uniLine2 = "информатики и радиоэлектроники"

  // Название университета в две строки, выровнено по левому краю относительно логотипа
  doc.text(uniLine1, textX, y + logoSize / 2 - lineHeight / 2)
  doc.text(uniLine2, textX, y + logoSize / 2 + lineHeight / 2)
  y += logoSize + 6
  return y
}

/** Рисует футер (логотип + университет) внизу страницы */
function drawFooterBlock(doc: jsPDF, pageWidth: number, pageHeight: number, margin: number) {
  const logoSize = 10
  const blue = [0.22, 0.45, 0.82] as [number, number, number]
  const y = pageHeight - margin - logoSize - 4

  // Пытаемся загрузить логотип BSUIR (приоритет PNG, так как jsPDF лучше поддерживает PNG)
  let logoLoaded = false
  const possibleLogoPaths = [
    "bsuir-logo.png",
    "bsuir.png",
    "logo-bsuir.png",
    "bsuir-logo.svg",
    "bsuir.svg",
    "logo-bsuir.svg",
  ]

  for (const logoName of possibleLogoPaths) {
    try {
      const logoPath = path.join(process.cwd(), "public", logoName)
      if (fs.existsSync(logoPath)) {
        const img = fs.readFileSync(logoPath)
        if (logoName.endsWith(".png")) {
          const base64 = `data:image/png;base64,${img.toString("base64")}`
          doc.addImage(base64, "PNG", margin, y, logoSize, logoSize)
          logoLoaded = true
          break
        }
        // SVG может не работать напрямую в jsPDF, но попробуем
        else if (logoName.endsWith(".svg")) {
          try {
            const base64 = `data:image/svg+xml;base64,${img.toString("base64")}`
            doc.addImage(base64, "SVG", margin, y, logoSize, logoSize)
            logoLoaded = true
            break
          } catch {
            // SVG не поддерживается, продолжаем поиск
          }
        }
      }
    } catch (e) {
      // Продолжаем поиск следующего файла
    }
  }

  // Если логотип не найден, используем fallback - синий квадрат
  if (!logoLoaded) {
    doc.setFillColor(blue[0] * 255, blue[1] * 255, blue[2] * 255)
    doc.rect(margin, y, logoSize, logoSize, "F")
  }

  doc.setFontSize(8)
  doc.setFont(FONT, "normal")
  doc.setTextColor(80, 80, 80)
  doc.text(
    "Белорусский государственный университет информатики и радиоэлектроники",
    margin + logoSize + 3,
    y + logoSize / 2,
    { align: "left", baseline: "middle" },
  )
}

/**
 * Генерация PDF‑отчёта в формате справки БГУИР (финальная версия, Сценарий Б).
 * Для черновика выдаётся упрощённый отчёт без QR‑кодов и верификации.
 */
export async function generatePDFReport(result: CheckResultForReport): Promise<Uint8Array> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  doc.setProperties({
    title: "Справка о результатах проверки на заимствования",
    creator: "БГУИР.ПЛАГИАТ",
  })
  loadDejaVuFonts(doc)
  doc.setFont(FONT, "normal")

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 20
  const isFinal = result.status === "final" && result.documentId
  const baseUrl = (result.baseUrl || "").replace(/\/$/, "")

  let y = margin

  // ——— Блок 1: Идентификация (шапка) ———
  y = drawHeaderBlock(doc, margin, pageWidth)
  // Отступ сверху между шапкой и заголовком "Справка"
  y += 10

  // Заголовок "Справка"
  doc.setFontSize(14)
  doc.setFont(FONT, "bold")
  doc.setTextColor(0, 0, 0)
  doc.text("Справка", margin, y)
  y += 7

  // Подзаголовок как на сайте: меньший кегль и серый цвет, в две строки
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.setTextColor(110, 110, 120)
  const subtitleLine1 = "о результатах проверки текстового документа"
  const subtitleLine2 = "на наличие заимствований"
  const subtitleLineHeight = 4.2
  doc.text(subtitleLine1, margin, y)
  y += subtitleLineHeight
  doc.text(subtitleLine2, margin, y)
  // Отступ снизу между блоком заголовка и остальным содержимым
  y += 12
  // Вернём основной цвет текста для последующих блоков
  doc.setTextColor(0, 0, 0)

  if (isFinal) {
    // Текст "ПРОВЕРКА ВЫПОЛНЕНА В СИСТЕМЕ БГУИР.ПЛАГИАТ" без верхней линии
    doc.setFontSize(9)
    doc.setFont(FONT, "bold")
    doc.setTextColor(0, 0, 0)
    doc.text("ПРОВЕРКА ВЫПОЛНЕНА В СИСТЕМЕ БГУИР.ПЛАГИАТ", margin, y)
    y += 5

    // Линия под текстом, как в оригинальном бланке
    doc.setDrawColor(230, 235, 246)
    doc.setLineWidth(0.4)
    doc.line(margin, y, pageWidth - margin, y)
    y += 6

    // Блок с реквизитами работы в две колонки
    const labelX = margin
    const valueX = margin + 40
    const rowHeight = 6

    doc.setFontSize(8)
    

    // ФИО
    doc.setFont(FONT, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text("ФИО:", labelX, y)
    doc.setFont(FONT, "normal")
    doc.setTextColor(110, 110, 120)
    doc.text(result.author || "—", valueX, y)
    y += rowHeight

    // Тип работы
    doc.setFont(FONT, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text("Тип работы:", labelX, y)
    doc.setFont(FONT, "normal")
    doc.setTextColor(110, 110, 120)
    doc.text(categoryLabel(result.category), valueX, y)
    y += rowHeight

    // Название работы (многострочное поле справа)
    doc.setFont(FONT, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text("Название работы:", labelX, y)
    doc.setFont(FONT, "normal")
    doc.setTextColor(110, 110, 120)
    const workTitle = result.title || result.filename || "—"
    const titleMaxWidth = pageWidth - valueX - margin
    const titleLines = doc.splitTextToSize(workTitle, titleMaxWidth)
    doc.text(titleLines, valueX, y, { maxWidth: titleMaxWidth })
    const extraTitleLines = Math.max(0, titleLines.length - 1)
    y += rowHeight + extraTitleLines * 4

    // Нижняя разделительная линия под блоком реквизитов
    doc.setDrawColor(230, 235, 246)
    doc.setLineWidth(0.4)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    // Вернём основной цвет для дальнейшего текста
    doc.setTextColor(0, 0, 0)
  } else {
    // Упрощённый вариант для черновика без декоративных линий
    doc.setFontSize(9)
    doc.setFont(FONT, "normal")
    doc.setTextColor(0, 0, 0)
    doc.text(`ФИО: ${result.author || "—"}`, margin, y)
    y += 6
    doc.text(`Тип работы: ${categoryLabel(result.category)}`, margin, y)
    y += 6
    doc.text(`Название работы: ${result.title || result.filename || "—"}`, margin, y, {
      maxWidth: pageWidth - 2 * margin,
    })
    y += 8
  }

  // ——— Блок 2: Результаты ——— (сразу после блока ФИО / Тип / Название)
  // Список источников для таблицы ниже (сортировка по доле сходства)
  const sourcesSorted = [...(result.similarDocuments || [])]
    .filter((s) => typeof s.similarity === "number" && Number.isFinite(s.similarity) && s.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)

  const topLocalShare =
    sourcesSorted.length > 0
      ? Math.round(Math.max(...sourcesSorted.map((s) => s.similarity)) * 100) / 100
      : null

  const fromStoredUniqueness = Math.round(result.uniquenessPercent * 100) / 100
  const impliedMatchFromStored = Math.round((100 - result.uniquenessPercent) * 100) / 100

  // Полосы «Совпадения / Оригинальность»: если есть перечень работ — совпадают с максимальной долей в таблице;
  // иначе берём сохранённые uniqueness/originality (в т.ч. отчёт без списка, восстановленный из БД).
  const matchesPercent =
    topLocalShare != null ? topLocalShare : impliedMatchFromStored
  const origPercent =
    topLocalShare != null ? Math.round((100 - topLocalShare) * 100) / 100 : fromStoredUniqueness

  const aiPercent = Math.round((result.aiPercentMl ?? 0) * 100) / 100

  // Небольшой отступ сверху перед блоком результатов (подвинули ближе к верхней линии)
  

  const blockLabelX = margin
  const metricsStartX = margin + 40 // чуть дальше от левого края, чтобы не наезжать на подписи
  const valueX = pageWidth - margin
  const rowHeight = 6

  // Заголовок блока слева
  doc.setFontSize(9)
  doc.setFont(FONT, "normal")
  doc.setTextColor(0, 0, 0)
  doc.text("Результаты:", blockLabelX, y)

  // Общие настройки для строк с метриками
  doc.setFontSize(9)
  const grayText = [110, 110, 120] as const
  const barGray = [230, 235, 246] as const

  // Ширина полосы между подписями и процентами.
  // Делаем короче, чтобы справа оставался зазор и проценты не заходили на полосы.
  const barX = metricsStartX + 32
  const percentGap = 18
  const barWidth = valueX - percentGap - barX
  const barHeight = 1.8

  // Первая строка: Совпадения
  let rowY = y
  doc.setFont(FONT, "normal")
  doc.setTextColor(...grayText)
  doc.text("Совпадения", metricsStartX, rowY)

  doc.setFillColor(...barGray)
  doc.rect(barX, rowY - barHeight / 2, barWidth, barHeight, "F")
  doc.setFillColor(255, 165, 0)
  doc.rect(barX, rowY - barHeight / 2, (barWidth * matchesPercent) / 100, barHeight, "F")

  doc.setTextColor(...grayText)
  doc.text(`${formatPercent(matchesPercent)}%`, valueX, rowY, { align: "right" })

  // Вторая строка: Оригинальность
  rowY += rowHeight
  doc.setTextColor(...grayText)
  doc.text("Оригинальность", metricsStartX, rowY)

  doc.setFillColor(...barGray)
  doc.rect(barX, rowY - barHeight / 2, barWidth, barHeight, "F")
  // Более тёмный синий для полосы оригинальности
  doc.setFillColor(32, 82, 181)
  doc.rect(barX, rowY - barHeight / 2, (barWidth * origPercent) / 100, barHeight, "F")

  doc.setTextColor(...grayText)
  doc.text(`${formatPercent(origPercent)}%`, valueX, rowY, { align: "right" })

  // Третья строка: ИИ
  rowY += rowHeight
  doc.setTextColor(...grayText)
  doc.text("ИИ", metricsStartX, rowY)

  doc.setFillColor(...barGray)
  doc.rect(barX, rowY - barHeight / 2, barWidth, barHeight, "F")
  doc.setFillColor(128, 82, 255) // фиолетовый
  doc.rect(barX, rowY - barHeight / 2, (barWidth * aiPercent) / 100, barHeight, "F")

  doc.setTextColor(...grayText)
  doc.text(`${formatPercent(aiPercent)}%`, valueX, rowY, { align: "right" })

  // Нижняя граница блока результатов
  y = rowY + 4
  doc.setDrawColor(230, 235, 246)
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // Вернём базовый цвет текста
  doc.setTextColor(0, 0, 0)

  // Блок "Дата проверки / Работу проверил / Дата / Подпись проверяющего"
  doc.setFontSize(8)
  doc.setTextColor(0, 0, 0)
  const baseLabelX = margin
  const dateValueX = margin + 36
  const underlineColor = [200, 200, 200] as const

  // Строка 1: "Дата проверки: 24.10.2024"
  doc.setFont(FONT, "normal")
  doc.text("Дата проверки:", baseLabelX, y)
  doc.setFont(FONT, "normal")
  doc.setTextColor(0, 0, 0)
  const dateText = formatDate(result.uploadDate)
  doc.text(dateText, dateValueX, y)
  // Чуть больший отступ перед следующей строкой
  y += 12

  // Строка 2: "Работу проверил (а): ____________" — длинная линия справа от подписи
  doc.setFont(FONT, "normal")
  doc.setTextColor(0, 0, 0)
  const checkedLabel = "Работу проверил (а):"
  doc.text(checkedLabel, baseLabelX, y)
  const checkedLabelWidth = (doc.getTextWidth ? doc.getTextWidth(checkedLabel) : 48) as number
  const checkedLineStartX = baseLabelX + checkedLabelWidth + 4
  const checkedLineEndX = pageWidth - margin
  doc.setDrawColor(...underlineColor)
  doc.setLineWidth(0.2)
  doc.line(checkedLineStartX, y + 1.2, checkedLineEndX, y + 1.2)
  // Увеличенный отступ сверху для нижней строки "Дата / Подпись проверяющего"
  y += 16

  // Строка 3: "Дата: ________       Подпись проверяющего: ________"
  const bottomDateLabel = "Дата:"
  doc.text(bottomDateLabel, baseLabelX, y)
  const bottomDateLabelWidth = (doc.getTextWidth ? doc.getTextWidth(bottomDateLabel) : 18) as number
  const bottomDateLineStartX = baseLabelX + bottomDateLabelWidth + 4
  const bottomDateLineWidth = 35
  doc.setDrawColor(...underlineColor)
  doc.setLineWidth(0.2)
  doc.line(bottomDateLineStartX, y + 1.2, bottomDateLineStartX + bottomDateLineWidth, y + 1.2)

  const signLabel = "Подпись проверяющего:"
  const signLabelX = pageWidth / 2
  doc.text(signLabel, signLabelX, y)
  const signLabelWidth = (doc.getTextWidth ? doc.getTextWidth(signLabel) : 52) as number
  const signLineStartX = signLabelX + signLabelWidth + 4
  const signLineEndX = pageWidth - margin
  doc.setDrawColor(...underlineColor)
  doc.line(signLineStartX, y + 1.2, signLineEndX, y + 1.2)
  y += 12

  // ——— Блок 3: QR-коды (между результатами и таблицей) ———
  if (isFinal && baseUrl) {
    try {
      const id = result.documentId!
      const { verifyUrl, originalUrl } = buildReportQrLinks(id, baseUrl)

      // Два блока: [QR] [текст справа], расположенные в одну строку.
      const qrSize = 30
      const blockGap = 16
      const availableWidth = pageWidth - 2 * margin
      const blockWidth = (availableWidth - blockGap) / 2

      const block1X = margin
      const block2X = margin + blockWidth + blockGap
      const qr1X = block1X
      const qr2X = block2X
      const qrY = y

      const textOffsetX = 6
      const captionW = blockWidth - qrSize - textOffsetX

      const qr1 = await QRCode.toDataURL(verifyUrl, { width: 200, margin: 1 })
      const qr2 = await QRCode.toDataURL(originalUrl, { width: 200, margin: 1 })

      doc.addImage(qr1, "PNG", qr1X, qrY, qrSize, qrSize)
      doc.setFontSize(8)
      doc.setFont(FONT, "normal")
      const qr1Lines = doc.splitTextToSize(
        "Для подтверждения подлинности и актуальности данной справки отсканируйте QR-код",
        captionW,
      )
      const qr2Lines = doc.splitTextToSize(
        "Для просмотра оригинальной электронной версии документа отсканируйте QR-код",
        captionW,
      )
      const textY = qrY + 6
      const lineHeight = 4 // мм при размере шрифта 8

      doc.text(qr1Lines, qr1X + qrSize + textOffsetX, textY, {
        maxWidth: captionW,
        align: "left",
      })

      doc.addImage(qr2, "PNG", qr2X, qrY, qrSize, qrSize)
      doc.text(qr2Lines, qr2X + qrSize + textOffsetX, textY, {
        maxWidth: captionW,
        align: "left",
      })

      const maxLines = Math.max(qr1Lines.length, qr2Lines.length)
      const textBlockHeight = maxLines * lineHeight

      // Высота блока = максимум из высоты QR и высоты текста
      const blockHeight = Math.max(qrSize, textBlockHeight + (textY - qrY))
      y = qrY + blockHeight + 10
    } catch (e) {
      console.error("Error generating QR codes:", e)
    }
  } else if (!isFinal) {
    doc.setFontSize(9)
    doc.setFont(FONT, "normal")
    doc.setTextColor(200, 120, 0)
    doc.text(
      "⚠ Черновая версия. Официальная справка с QR-кодами доступна только для финальной версии (Сценарий Б).",
      margin,
      y,
      { maxWidth: pageWidth - 2 * margin },
    )
    doc.setTextColor(0, 0, 0)
    y += 10
  }

  // ——— Блок 4: Таблица «Источники» (под QR-кодами) ———
  if (y > pageHeight - 70) {
    doc.addPage()
    y = margin
  }
  doc.setFontSize(9)
  doc.setFont(FONT, "bold")
  doc.text("Источники", margin, y)
  y += 8

  const colNo = 12
  const colAuthors = 28
  const colShare = 20
  const colSource = pageWidth - margin - colNo - colAuthors - colShare - 6
  const rowH = 7
  const headY = y

  doc.setFontSize(9)
  doc.setFont(FONT, "bold")
  // Линии над и под строкой заголовка таблицы в общем стиле (слегка голубые)
  const headerTopY = headY - 3.5
  const headerBottomY = headY + 3.5
  doc.setDrawColor(230, 235, 246)
  doc.setLineWidth(0.4)
  doc.line(margin, headerTopY, pageWidth - margin, headerTopY)
  doc.line(margin, headerBottomY, pageWidth - margin, headerBottomY)

  // Текст заголовка, выровненный по центру между линиями
  const headerTextY = headY + 0.1
  doc.text("№", margin + colNo / 2, headerTextY, { align: "center" })
  doc.text("Авторы", margin + colNo + colAuthors / 2, headerTextY, { align: "center" })
  doc.text("Доля", margin + colNo + colAuthors + colShare / 2, headerTextY, { align: "center" })
  doc.text("Источник", margin + colNo + colAuthors + colShare + colSource / 2, headerTextY, {
    align: "center",
  })
  y += rowH + 2

  doc.setFont(FONT, "normal")
  const tableTextWidth = pageWidth - 2 * margin

  if (sourcesSorted.length > 0) {
    sourcesSorted.forEach((s, idx) => {
      if (y > pageHeight - 25) {
        doc.addPage()
        y = margin
      }
      const authorMark = (s.userId || s.author || "—").toString().slice(0, 14)
      doc.text(String(idx + 1), margin + colNo / 2, y + 0.5, { align: "center" })
      doc.text(authorMark, margin + colNo + 2, y + 0.5)
      doc.text(formatPercent(s.similarity), margin + colNo + colAuthors + colShare / 2, y + 0.5, {
        align: "center",
      })
      const title = (s.title || "—").slice(0, 55)
      doc.text(title, margin + colNo + colAuthors + colShare + 2, y + 0.5)
      y += rowH + 2
    })
  } else if (impliedMatchFromStored > 0.5 || (result.plagiarismPercentMl ?? 0) > 0.5) {
    // Нельзя утверждать «совпадений нет», если в блоке результатов ненулевые метрики, а список просто не передан (напр. PDF из профиля).
    doc.setFontSize(8)
    const ml = result.plagiarismPercentMl
    let note =
      "Перечень похожих работ из локальной базы в этот файл не включён (список не сохранялся при генерации — например, справка сформирована из профиля). Показатели в блоке «Результаты» соответствуют сохранённой проверке."
    if (typeof ml === "number" && ml > 0.5) {
      note += ` Совпадения по векторной базе (ML): ${formatPercent(ml)}%.`
    }
    const noteLines = doc.splitTextToSize(note, tableTextWidth)
    doc.text(noteLines, margin, y + 0.5)
    y += noteLines.length * 4 + 4
    doc.setFontSize(9)
  } else {
    doc.text("1", margin + colNo / 2, y + 0.5, { align: "center" })
    doc.text("—", margin + colNo + 2, y + 0.5)
    doc.text("—", margin + colNo + colAuthors + colShare / 2, y + 0.5, { align: "center" })
    doc.text("Совпадений не найдено", margin + colNo + colAuthors + colShare + 2, y + 0.5)
    y += rowH + 2
  }
  y += 6

  // Футер на всех страницах
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    drawFooterBlock(doc, pageWidth, pageHeight, margin)
    doc.setFontSize(8)
    doc.setFont(FONT, "normal")
    doc.setTextColor(128, 128, 128)
    doc.text(
      `БГУИР.ПЛАГИАТ — Стр. ${i} из ${totalPages}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" },
    )
  }

  return doc.output("arraybuffer") as unknown as Uint8Array
}
