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
