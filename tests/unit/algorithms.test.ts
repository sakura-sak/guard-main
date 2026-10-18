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

  it("cuts a real appendix in the second half and keeps an excel mention", () => {
    const body = "Ход работы. ".repeat(40) + "Используя приложение Microsoft Excel, сгенерировать выборку."
    const raw = `${body}\nПриложение А\nЛистинг программы который не должен участвовать в проверке оригинальности.`
    const normalized = normalizeContentForCheck(raw)
    expect(normalized).toContain("приложение Microsoft Excel")
    expect(normalized).not.toContain("Листинг программы")
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
