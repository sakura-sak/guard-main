import { describe, expect, it } from "vitest"
import {
  MinHash,
  compareMinHashSignatures,
  createShingles,
  createWordShingles,
  findMatchingFragments,
  jaccardSimilarity,
  normalizeContentForCheck,
  preprocessText,
} from "@/lib/plagiarism/algorithms"

describe("plagiarism algorithms", () => {
  it("preprocesses text to lowercase without punctuation", () => {
    expect(preprocessText("Привет, Мир!")).toBe("привет мир")
  })

  it("drops a contents heading and keeps the document body", () => {
    const body = "Введение. Основной текст лабораторной работы про алгоритмы и структуры данных."
    const normalized = normalizeContentForCheck(`${body}\nСодержание\n`)
    expect(normalized).toContain("Основной текст")
    expect(normalized.split("\n").some((line) => /^\s*содержание\s*$/i.test(line))).toBe(false)
  })

  it("returns the original text when cleanup would leave fewer than 50 characters", () => {
    expect(normalizeContentForCheck("короткий текст")).toBe("короткий текст")
  })

  it("stores the same canonical text for a Word-like and a PDF-like extract", () => {
    const body =
      "Цель работы Изучить методы получения вероятностного описания параметра по результатам его экспериментального наблюдения и проверить гипотезу."
    const cover = [
      "Министерство образования Республики Беларусь",
      "Учреждение образования «БГУИР»",
      "Кафедра информационных технологий",
      "Выполнил студент гр. 418302 Иванов И.И.",
      "Проверил Петров П.П.",
      "Минск 2026",
    ]
    const fromDocx = [...cover, body].join("\n\n")
    const fromPdf = `${cover.join(" ")} ${body}`
    expect(normalizeContentForCheck(fromDocx)).toBe(normalizeContentForCheck(fromPdf))
    expect(normalizeContentForCheck(fromDocx)).toBe(body)
  })

  it("drops a BSUIR title page but keeps the body", () => {
    const body =
      "Цель работы Изучить методы получения вероятностного описания параметра по результатам его экспериментального наблюдения и проверить гипотезу."
    const raw = [
      "Министерство образования Республики Беларусь",
      "Учреждение образования «БГУИР»",
      "Кафедра информационных технологий",
      "Выполнили студент гр. 418302 Чугунов Т.М.",
      "Проверил Крез К.С.",
      "Минск 2026",
      body,
    ].join("\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Цель работы")
    expect(normalized).not.toMatch(/выполнил/i)
    expect(normalized).not.toMatch(/проверил/i)
    expect(normalized).not.toMatch(/минск/i)
  })

  it("drops table-of-contents lines including an appendix entry", () => {
    const body =
      "Цель работы Изучить методы получения вероятностного описания параметра и проверить гипотезу о законе распределения."
    const raw = [
      body,
      "Содержание",
      "Введение ........ 3",
      "Приложение А .... 25",
      "Ход работы состоит в генерации выборки и проверке гипотезы критерием Пирсона.",
    ].join("\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Цель работы")
    expect(normalized).toContain("Ход работы")
    expect(normalized).not.toMatch(/введение\s+\.{2,}/i)
    expect(normalized).not.toMatch(/приложение а/i)
  })

  it("cuts a real appendix and keeps an excel mention", () => {
    const body = "Ход работы. ".repeat(40) + "Используя приложение Microsoft Excel, сгенерировать выборку."
    const raw = `${body}\nПриложение А\nЛистинг программы который не должен участвовать в проверке оригинальности.`
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("приложение Microsoft Excel")
    expect(normalized).not.toContain("Листинг программы")
  })

  it("keeps prose about the application and cuts only a real appendix heading", () => {
    const raw = [
      "Готовность приложения к эксплуатации подтверждена испытаниями и покрытием тестов.",
      "Стабильность работы приложения в условиях реальной нагрузки сохраняется до сдачи.",
      "Заключение. Цели курсового проекта достигнуты, система готова к внедрению в магазине.",
      "ПРИЛОЖЕНИЕ А",
      "(обязательное)",
      "Текст программы public class SupplyController { return ResponseEntity.ok(dto); }",
      "ПРИЛОЖЕНИЕ Б",
      "CREATE TABLE brands( id BIGSERIAL PRIMARY KEY );",
    ].join("\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("приложения к эксплуатации")
    expect(normalized).toContain("приложения в условиях")
    expect(normalized).toContain("Цели курсового проекта")
    expect(normalized).not.toContain("SupplyController")
    expect(normalized).not.toContain("CREATE TABLE")
  })

  it("cuts every appendix from the first heading, including later listings and a page number", () => {
    const body = "В курсовом проекте описаны поставки, роли пользователей и структура таблиц базы."
    const raw = [
      body,
      "ПРИЛОЖЕНИЕ А (обязательное) Отчет о проверке на заимствования в системе «Антиплагиат» Рисунок А.1 – Результаты проверки на оригинальность",
      "84 ПРИЛОЖЕНИЕ Б (обязательное) Листинг кода алгоритмов @RestController @RequestMapping(\"/supplies\") public class SupplyController { private final SupplyService supplyService; }",
      "90 ПРИЛОЖЕНИЕ В ( обязательно е ) Листинг скрипта генерации базы данных CREATE TABLE brands( id BIGSERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE);",
      "92 ПРИЛОЖЕНИЕ Г ( обязательное ) Ведомость документов курсового проекта",
    ].join(" ")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("структура таблиц базы")
    expect(normalized).not.toMatch(/приложение/i)
    expect(normalized).not.toContain("SupplyController")
    expect(normalized).not.toContain("CREATE TABLE")
    expect(normalized).not.toContain("Ведомость документов")
  })

  it("cuts an appendix heading even when it is in the first half", () => {
    const head = "Ход работы. Краткое описание алгоритма и полученных результатов эксперимента."
    const raw = `${head}\nПриложение А\nЛистинг который не должен остаться в проверке оригинальности текста.`
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Ход работы")
    expect(normalized).not.toContain("Листинг который")
  })

  it("drops a long dotted contents line and glued page numbers, but keeps chapters before the conclusion", () => {
    const dots = ".".repeat(80)
    const raw = [
      "Министерство образования Республики Беларусь",
      "Учреждение образования БГУИР",
      "Минск, 2026",
      "Содержание",
      `Вывод ${dots} 19`,
      "Введение3",
      "Вывод20",
      "Глава 1. Постановка задачи и описание исходных данных для расчёта.",
      "Глава 2. Проектирование модулей и сравнение полученных результатов.",
      "Вывод. Оба предыдущих раздела остаются в тексте проверки.",
    ].join("\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Глава 1")
    expect(normalized).toContain("Глава 2")
    expect(normalized).toContain("Оба предыдущих раздела")
    expect(normalized).not.toMatch(/вывод\s+\.{2,}/i)
    expect(normalized).not.toMatch(/введение3/i)
    expect(normalized).not.toMatch(/вывод20/i)
    expect(normalized).not.toMatch(/минск/i)
  })

  it("drops a pdf title with a split year and a contents line with spaced dot leaders", () => {
    const leader = `${".".repeat(24)} ${".".repeat(24)} ${".".repeat(16)}`
    const raw = [
      "Министерство образования Республики Беларусь Учреждение образования БЕЛОРУССКИЙ ГОСУДАРСТВЕННЫЙ УНИВЕРСИТЕТ ИНФОРМАТИКИ И РАДИОЭЛЕКТРОНИКИ Факультет компьютерного проектирования Кафедра проектирования информационно - компьютерных систем ОТЧЕТ по лабораторной работ е на тему: РАЗРАБОТКА МОДЕЛИ ПРОЕКТА. КАЛЕНДАРНОЕ ПЛАНИРОВАНИЕ РАБОТ Выполнил Баразнов Д. Д . (подпись студента ) гр. 314301 Проверил Левченя Ж.Б. (подпись преподавателя ) Минск, 202 6",
      `СОДЕРЖАНИЕ 1 С оздание нового плана проекта ${leader} 3 2 Н астройка нерабочих дней ${leader} 4 В ыводы ${leader} 16`,
      "Создание календарного графика описано в первом разделе и включает длительность задач.",
    ].join("\n\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("календарного графика")
    expect(normalized).not.toMatch(/министерство образования/i)
    expect(normalized).not.toMatch(/подпись студента/i)
    expect(normalized).not.toMatch(/содержание/i)
    expect(normalized).not.toMatch(/с оздание нового плана/i)
    expect(normalized).not.toMatch(/в ыводы/i)
  })

  it("drops a contents heading with spaces inside the word and numbered subsections", () => {
    const leader = `${".".repeat(20)} ${".".repeat(20)} ${".".repeat(12)}`
    const raw = `2 СОДЕРЖА Н ИЕ 1 П ланирование управления стоимостью ${leader} 3 1.1 План управления стоимостью StudyFlow ${leader} 3 6.4 Основные и прогнозные показатели EVM ${leader} 11 З аключение ${leader} 19 Заключение. В работе рассчитаны ROI и NPV для проекта и сделан вывод о целесообразности затрат.`
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("ROI и NPV")
    expect(normalized).toContain("Заключение")
    expect(normalized).not.toMatch(/содержа\s*н\s*ие/i)
    expect(normalized).not.toMatch(/studyflow/i)
    expect(normalized).not.toMatch(/з аключение/i)
  })

  it("drops a flat contents block with glued page numbers", () => {
    const body = "Введение. Дальше идёт основной текст лабораторной работы про структуры данных."
    const raw = `Содержание Введение3 Ход работы ${".".repeat(60)} 12 ${body}`
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("основной текст")
    expect(normalized).toContain("Введение. Дальше")
    expect(normalized).not.toMatch(/введение3/i)
    expect(normalized).not.toMatch(/ход работы\s+\.{2,}/i)
    expect(normalized).not.toMatch(/содержание/i)
  })

  it("does not cut the beginning when the title template is absent", () => {
    const raw = [
      "Кафедра информационных технологий",
      "Минск",
      "Глава 1. Постановка задачи без полного титульного шаблона министерства.",
      "Реализация алгоритма остаётся в главе, даже если дальше идёт вывод.",
      "Вывод. Начало работы не отбрасывается, потому что титул не найден.",
    ].join("\n")
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Кафедра")
    expect(normalized).toContain("Глава 1")
    expect(normalized).toContain("Реализация алгоритма")
    expect(normalized).toContain("Вывод")
  })

  it("drops figure and table captions", () => {
    const raw =
      "Ход работы описывает алгоритм, результат показан на рисунке 1 и сведён в таблица 2 этого отчёта."
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("Ход работы описывает алгоритм")
    expect(normalized).not.toMatch(/рисунке\s*1/i)
    expect(normalized).not.toMatch(/таблицу\s*2/i)
  })

  it("builds overlapping character shingles", () => {
    const shingles = createShingles("абвгде", 3)
    expect(shingles.has("абв")).toBe(true)
    expect(shingles.has("бвг")).toBe(true)
    expect(shingles.size).toBe(4)
  })

  it("returns the whole string when it is shorter than k", () => {
    expect([...createShingles("ab", 5)]).toEqual(["ab"])
  })

  it("builds word shingles of length 3", () => {
    const set = createWordShingles("один два три четыре", 3)
    expect(set.has("один два три")).toBe(true)
    expect(set.has("два три четыре")).toBe(true)
  })

  it("gives identical MinHash signatures for the same text", () => {
    const text = "проверка лабораторной работы на заимствования внутри вуза"
    const hasher = new MinHash(32)
    const a = hasher.computeSignature(createShingles(text, 5))
    const b = hasher.computeSignature(createShingles(text, 5))
    expect(compareMinHashSignatures(a, b)).toBe(1)
  })

  it("gives lower similarity for unrelated texts", () => {
    const hasher = new MinHash(64)
    const a = hasher.computeSignature(createShingles("алгоритмы сортировки массива пузырьком", 5))
    const b = hasher.computeSignature(createShingles("рецепт борща со сметаной и чесноком", 5))
    expect(compareMinHashSignatures(a, b)).toBeLessThan(0.5)
  })

  it("throws when signature lengths differ", () => {
    expect(() => compareMinHashSignatures([1, 2], [1])).toThrow(/same length/)
  })

  it("computes Jaccard of two shingle sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3)
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0)
  })

  it("finds a shared fragment of at least five words", () => {
    const a = "в данной работе рассмотрены методы поиска похожих документов в корпусе вуза"
    const b = "автор пишет что методы поиска похожих документов в корпусе вуза дают результат"
    const matches = findMatchingFragments(a, b, 5)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].wordCount).toBeGreaterThanOrEqual(5)
  })
})
