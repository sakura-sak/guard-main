/**
 * Plagiarism Detection Algorithms
 * Implements: Shingling, MinHash, LSH, Jaccard & Cosine similarity
 * Based on: Broder (1997), Rajaraman & Ullman (2011)
 */

// Simple hash function (browser-compatible)
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

// =============================================================================
// TEXT PREPROCESSING
// =============================================================================

export function preprocessText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\sа-яё]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// \b в JS без флага u не видит кириллицу, поэтому границы слов — через \p{L}.
const WORD_BEFORE = "(?<![\\p{L}\\p{N}_])"
const WORD_AFTER = "(?![\\p{L}\\p{N}_])"

const COVER_LINE_PATTERNS = [
  /министерств[оа]\s+образования/iu,
  /республики\s+беларусь/iu,
  /учреждение\s+образования/iu,
  /белорусск(?:ий|ого)\s+государственн(?:ый|ого)\s+университет/iu,
  /информатики\s+и\s+радиоэлектроники/iu,
  new RegExp(`${WORD_BEFORE}бгуир${WORD_AFTER}`, "iu"),
  new RegExp(`${WORD_BEFORE}кафедр[аы]${WORD_AFTER}`, "iu"),
  /учебная\s+дисциплина/iu,
  /отч[её]т\s+по\s+лабораторной\s+работе/iu,
  new RegExp(`${WORD_BEFORE}лабораторная\\s+работа\\s*№?\\s*\\d*`, "iu"),
  new RegExp(`${WORD_BEFORE}выполнил(?:а|и)?${WORD_AFTER}`, "iu"),
  new RegExp(`${WORD_BEFORE}проверил(?:а)?${WORD_AFTER}`, "iu"),
  new RegExp(`${WORD_BEFORE}минск${WORD_AFTER}`, "iu"),
]

const CONTENT_START_MARKERS = [
  "введение",
  "цель работы",
  "цель лабораторной работы",
  "задание",
  "вариант",
  "ход работы",
  "ход выполнения",
  "теоретические сведения",
  "постановка задачи",
  "основная часть",
  "практическая часть",
  "реализация",
  "результаты выполнения",
  "описание алгоритма",
  "вывод",
  "заключение",
]

const FIGURE_REFERENCE_PATTERNS = [
  /(^|\s)(?:представлен[аыо]?|показан[аыо]?|приведен[аыо]?|изображен[аыо]?|отображен[аыо]?|расположен[аыо]?)\s+(?:на|в)\s+(?:рисунк[еа]|рис\.?|таблиц[еа]|табл\.?)\s*№?\s*\d+(?:\.\d+)?/gi,
  /(^|\s)(?:рисунок|рис\.|таблица|табл\.)\s*№?\s*\d+(?:\.\d+)?/gi,
]

function countCoverMarkers(text: string): number {
  return COVER_LINE_PATTERNS.reduce((count, pattern) => {
    pattern.lastIndex = 0
    return count + (pattern.test(text) ? 1 : 0)
  }, 0)
}

/** Один вид пробелов для PDF и Word: без переносов строк и лишних пробелов. */
export function canonicalizeForStorage(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

function isWordBoundStart(text: string, index: number): boolean {
  if (index <= 0) return true
  return !/[\p{L}\p{N}_]/u.test(text[index - 1] || "")
}

function isWordBoundEnd(text: string, index: number): boolean {
  if (index >= text.length) return true
  return !/[\p{L}\p{N}_]/u.test(text[index] || "")
}

/** Пункт оглавления сразу после заголовка: «Введение ........ 3». */
function isTocStyleMatch(text: string, index: number, markerLength: number): boolean {
  const after = text.slice(index + markerLength)
  return /^\s*[\.…]{2,}\s*\d{1,4}(?:\s|$)/u.test(after)
}

function findContentStartIndex(text: string): number | null {
  const window = text.slice(0, 16000)
  const lower = window.toLowerCase()
  if (countCoverMarkers(lower) < 3) return null

  let best = -1
  for (const marker of CONTENT_START_MARKERS) {
    let from = 0
    while (from < lower.length) {
      const index = lower.indexOf(marker, from)
      if (index < 0) break
      const end = index + marker.length
      if (!isWordBoundStart(window, index) || !isWordBoundEnd(window, end) || isTocStyleMatch(window, index, marker.length)) {
        from = end
        continue
      }
      if (best < 0 || index < best) best = index
      break
    }
  }
  return best >= 0 ? best : null
}

function stripFigureReferences(text: string): string {
  return FIGURE_REFERENCE_PATTERNS.reduce((out, pattern) => out.replace(pattern, " "), text)
}

function hasFigureReference(text: string): boolean {
  return FIGURE_REFERENCE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

export function isLikelyBoilerplateText(text: string): boolean {
  const normalized = preprocessText(text)
  if (!normalized) return false
  const withoutFigureRefs = preprocessText(stripFigureReferences(normalized))
  if (hasFigureReference(normalized) && (!withoutFigureRefs || withoutFigureRefs.length < 20)) return true
  const coverMarkers = countCoverMarkers(normalized)
  const hasContentMarker = CONTENT_START_MARKERS.some((marker) => normalized.includes(marker))
  return coverMarkers >= 3 && !hasContentMarker
}

function stripLeadingCoverBlock(text: string): string {
  const start = findContentStartIndex(text)
  if (start == null || start < 1) return text
  return text.slice(start)
}

function stripFlatContentsBlock(text: string): string {
  return text.replace(
    /(?:^|\s)(?:содержание|оглавление)(?:\s+\S.{0,100}?(?:\.{2,}|\s)\d{1,4})+/giu,
    " ",
  )
}

function stripTrailingAppendix(text: string): string {
  const halfway = Math.floor(text.length / 2)
  const tail = text.slice(halfway)
  const match = tail.match(/\sприложени[ея]\s+(?:№\s*)?(?:[\p{L}](?![\p{L}])|\d{1,3}(?!\d))/iu)
  if (!match || match.index == null) return text
  return text.slice(0, halfway + match.index).trim()
}

function isContentsHeading(line: string): boolean {
  return /^\s*(?:содержание|оглавление)\s*$/iu.test(line)
}

/** Пункт оглавления: «Введение ........ 3» или «1. Теория 5». */
function isContentsEntry(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  return /(?:\.{2,}|\s)\d{1,4}\s*$/.test(trimmed)
}

function isContentHeading(line: string): boolean {
  const lower = line.trim().toLowerCase()
  return CONTENT_START_MARKERS.some(
    (marker) => lower === marker || lower.startsWith(`${marker} `) || lower.startsWith(`${marker}.`),
  )
}

/**
 * Заголовок приложения: «Приложение А», «ПРИЛОЖЕНИЕ 1», «Приложение № 2».
 * «приложение Microsoft Excel» не подходит: после слова идёт длинное слово, не буква/номер.
 */
function isAppendixHeading(line: string): boolean {
  const trimmed = line.trim()
  if (/^приложени[ея]$/iu.test(trimmed)) return true
  return /^приложени[ея]\s+(?:№\s*)?(?:[\p{L}](?![\p{L}])|\d{1,3}(?!\d))/iu.test(trimmed)
}

/**
 * Черновое удаление служебных разделов документа
 * (титульный лист, содержание/оглавление, приложения)
 * перед расчётом оригинальности.
 *
 * Приложение отрезается только заголовком во второй половине текста,
 * чтобы пункт оглавления и фраза «приложение Microsoft Excel» не съели работу.
 */
export function stripNonContentSections(rawText: string): string {
  const withoutCoverBlock = stripFigureReferences(stripLeadingCoverBlock(rawText))
  const lines = withoutCoverBlock.split(/\r?\n/)
  const result: string[] = []
  const halfway = withoutCoverBlock.length / 2

  let inAppendix = false
  let inContents = false
  let offset = 0

  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()

    if (inAppendix) continue

    if (!inContents && lineStart >= halfway && isAppendixHeading(trimmed)) {
      inAppendix = true
      continue
    }

    if (isContentsHeading(line)) {
      inContents = true
      continue
    }

    if (inContents) {
      if (isContentsEntry(trimmed)) continue
      inContents = false
    }

    // Удаляем явные упоминания титульного листа
    if (lower.includes("титульный лист")) {
      continue
    }

    if (
      trimmed.length < 250 &&
      COVER_LINE_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0
        return pattern.test(trimmed)
      })
    ) {
      continue
    }

    result.push(line)
  }

  const joined = stripTrailingAppendix(stripFlatContentsBlock(result.join("\n").trim()))
  // На всякий случай: если после очистки текста почти нет, возвращаем исходный
  if (joined.length < 50) {
    return canonicalizeForStorage(rawText)
  }

  return canonicalizeForStorage(joined)
}

/**
 * Нормализация текста для проверки на плагиат.
 * PDF и Word после этой функции должны давать один и тот же канонический текст.
 */
export function normalizeContentForCheck(text: string): string {
  return stripNonContentSections(text)
}

// =============================================================================
// SHINGLING
// =============================================================================

export function createShingles(text: string, k = 5): Set<string> {
  const processed = preprocessText(text)

  if (processed.length < k) {
    return new Set([processed])
  }

  const shingles = new Set<string>()
  for (let i = 0; i <= processed.length - k; i++) {
    shingles.add(processed.slice(i, i + k))
  }

  return shingles
}

export function createWordShingles(text: string, k = 3): Set<string> {
  const processed = preprocessText(text)
  const words = processed.split(" ").filter((w) => w.length > 0)

  if (words.length < k) {
    return new Set([words.join(" ")])
  }

  const shingles = new Set<string>()
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(" "))
  }

  return shingles
}

// =============================================================================
// MINHASH
// =============================================================================

export class MinHash {
  private numHashes: number
  private hashParams: Array<{ a: number; b: number }>
  private maxHash: number = 2 ** 31 - 1
  private prime = 2147483647

  constructor(numHashes = 128, seed = 42) {
    this.numHashes = numHashes
    this.hashParams = []

    // Deterministic random based on seed
    let state = seed
    const random = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }

    for (let i = 0; i < numHashes; i++) {
      this.hashParams.push({
        a: Math.floor(random() * this.maxHash) + 1,
        b: Math.floor(random() * this.maxHash),
      })
    }
  }

  private hashShingle(shingle: string): number {
    return simpleHash(shingle)
  }

  computeSignature(shingles: Set<string>): number[] {
    if (shingles.size === 0) {
      return new Array(this.numHashes).fill(this.maxHash)
    }

    const signature = new Array(this.numHashes).fill(this.maxHash)

    for (const shingle of shingles) {
      const shingleHash = this.hashShingle(shingle)

      for (let i = 0; i < this.numHashes; i++) {
        const { a, b } = this.hashParams[i]
        const hashValue = Math.abs((a * shingleHash + b) % this.prime)
        signature[i] = Math.min(signature[i], hashValue)
      }
    }

    return signature
  }

  estimateSimilarity(sig1: number[], sig2: number[]): number {
    if (sig1.length !== sig2.length) {
      throw new Error("Signatures must have same length")
    }

    let matches = 0
    for (let i = 0; i < sig1.length; i++) {
      if (sig1[i] === sig2[i]) matches++
    }

    return matches / sig1.length
  }
}

// Function to compare MinHash signatures
export function compareMinHashSignatures(sig1: number[], sig2: number[]): number {
  if (sig1.length !== sig2.length) {
    throw new Error("Signatures must have same length")
  }

  let matches = 0
  for (let i = 0; i < sig1.length; i++) {
    if (sig1[i] === sig2[i]) matches++
  }

  return matches / sig1.length
}

// =============================================================================
// LSH (Locality-Sensitive Hashing)
// =============================================================================

export class LSH {
  private numBands: number
  private rowsPerBand: number

  constructor(numBands = 16, rowsPerBand = 8) {
    this.numBands = numBands
    this.rowsPerBand = rowsPerBand
  }

  private hashBand(band: number[]): string {
    return band.join(",")
  }

  getBuckets(signature: number[]): Array<{ bandId: number; hash: string }> {
    const buckets: Array<{ bandId: number; hash: string }> = []

    for (let bandId = 0; bandId < this.numBands; bandId++) {
      const start = bandId * this.rowsPerBand
      const end = start + this.rowsPerBand
      const band = signature.slice(start, end)

      buckets.push({
        bandId,
        hash: this.hashBand(band),
      })
    }

    return buckets
  }
}

// =============================================================================
// SIMILARITY METRICS
// =============================================================================

export function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 || set2.size === 0) return 0

  let intersection = 0
  for (const item of set1) {
    if (set2.has(item)) intersection++
  }

  const union = set1.size + set2.size - intersection
  return union > 0 ? intersection / union : 0
}

export function cosineSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 || set2.size === 0) return 0

  let intersection = 0
  for (const item of set1) {
    if (set2.has(item)) intersection++
  }

  return intersection / (Math.sqrt(set1.size) * Math.sqrt(set2.size))
}

// =============================================================================
// FRAGMENT MATCHING
// =============================================================================

export interface MatchingFragment {
  text: string
  positionDoc1: number
  positionDoc2: number
  wordCount: number
}

export function findMatchingFragments(text1: string, text2: string, minWords = 5): MatchingFragment[] {
  const words1 = preprocessText(text1)
    .split(" ")
    .filter((w) => w.length > 0)
  const words2 = preprocessText(text2)
    .split(" ")
    .filter((w) => w.length > 0)
  const text2Str = words2.join(" ")

  const matches: MatchingFragment[] = []
  const usedPositions = new Set<number>()

  for (let i = 0; i <= words1.length - minWords; i++) {
    if (usedPositions.has(i)) continue

    let matchEnd = i + minWords

    while (matchEnd <= words1.length) {
      const fragment = words1.slice(i, matchEnd).join(" ")
      if (text2Str.includes(fragment)) {
        matchEnd++
      } else {
        break
      }
    }
    matchEnd--

    if (matchEnd > i + minWords - 1) {
      const matchedText = words1.slice(i, matchEnd).join(" ")
      if (isLikelyBoilerplateText(matchedText)) {
        continue
      }
      const posInText2 = text2Str.indexOf(matchedText)

      matches.push({
        text: matchedText,
        positionDoc1: i,
        positionDoc2: posInText2,
        wordCount: matchEnd - i,
      })

      for (let j = i; j < matchEnd; j++) {
        usedPositions.add(j)
      }
    }
  }

  return matches.sort((a, b) => b.wordCount - a.wordCount)
}
