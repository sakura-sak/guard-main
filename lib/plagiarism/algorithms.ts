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

const TITLE_BLOCK_WINDOW = 4000

/**
 * Титул одним куском: от «Министерство образования» до «Минск» и года.
 * Если такой пары нет, начало текста не трогаем.
 */
const CONTENTS_WORD =
  "с\\s{0,2}о\\s{0,2}д\\s{0,2}е\\s{0,2}р\\s{0,2}ж\\s{0,2}а\\s{0,2}н\\s{0,2}и\\s{0,2}е|с\\s{0,2}о\\s{0,2}д\\s{0,2}е\\s{0,2}р\\s{0,2}а\\s{0,2}ж\\s{0,2}а\\s{0,2}н\\s{0,2}и\\s{0,2}е|о\\s{0,2}г\\s{0,2}л\\s{0,2}а\\s{0,2}в\\s{0,2}л\\s{0,2}е\\s{0,2}н\\s{0,2}и\\s{0,2}е"

function stripTitleBlock(text: string): string {
  const start = /министерств[оа]\s+образования/iu.exec(text)
  if (!start || start.index == null) return text
  const tail = text.slice(start.index)
  // PDF часто рвёт год пробелом: «Минск, 202 6».
  const end = /минск\s*,?\s*(?:19|20)(?:\s*\d){2}(?!\d)/iu.exec(tail)
  if (!end || end.index == null || end.index > TITLE_BLOCK_WINDOW) return text
  return text.slice(start.index + end.index + end[0].length)
}

function isContentsHeading(line: string): boolean {
  return new RegExp(String.raw`^\s*(?:\d{1,4}\s+)?(?:${CONTENTS_WORD})\s*$`, "iu").test(line)
}

/** Пункт оглавления: точки, «Введение6», «1.3 Обоснование ...11», «Приложение А ...44». */
function hasTrailingPageNumber(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (/(?:\.\s*){2,}\d{1,4}\s*$/u.test(trimmed) || /…+\s*\d{1,4}\s*$/u.test(trimmed)) return true
  const end = trimmed.match(/(\d{1,4})\s*$/u)
  if (!end || !isPageNumber(end[1] || "")) return false
  if (trimmed.length > 350) return false
  if (/[\p{L}][.!?]\s+\p{L}/u.test(trimmed) && !/^приложени[ея]\s/iu.test(trimmed)) return false
  const title = trimmed.replace(/(?:[^\d\s])?\s*\d{1,4}\s*$/u, "").trim()
  if (/^глава$/iu.test(title)) return false
  if (/^(?:глава\s+)?\d+(?:\.\d+)*$/iu.test(title)) return false
  return true
}

function isContentsEntry(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  return hasTrailingPageNumber(trimmed)
}

/**
 * Заголовок приложения: «Приложение А», «ПРИЛОЖЕНИЕ 1», «Приложение № 2».
 * Пункт оглавления и «приложение Microsoft Excel» сюда не входят.
 */
/** Буква приложения только прописная: «А», «Б». Строчные «к», «в», «с» — это текст работы. */
function isAppendixMarker(marker: string): boolean {
  if (/^\d{1,3}$/u.test(marker)) return true
  return /^\p{L}$/u.test(marker) && marker === marker.toUpperCase()
}

function isAppendixTocLine(line: string): boolean {
  const trimmed = line.trim()
  if (!hasTrailingPageNumber(trimmed)) return false
  return /^приложени[ея]\s+(?:№\s*)?[\p{L}\d]/iu.test(trimmed)
}

function isAppendixHeading(line: string): boolean {
  const trimmed = line.trim()
  if (hasTrailingPageNumber(trimmed)) return false
  const match = /^(?:\d{1,4}\s+)?приложени[ея]\s+(?:№\s*)?([\p{L}](?![\p{L}])|\d{1,3}(?!\d))/iu.exec(trimmed)
  return match != null && isAppendixMarker(match[1] || "")
}

function stripContentsAndAppendix(text: string): string {
  const lines = text.split(/\r?\n/)
  const result: string[] = []
  let inContents = false
  let inAppendix = false

  for (const line of lines) {
    if (inAppendix) continue

    if (!inContents && isAppendixTocLine(line)) continue

    if (!inContents && isAppendixHeading(line)) {
      inAppendix = true
      continue
    }

    if (isContentsHeading(line)) {
      inContents = true
      continue
    }

    if (inContents) {
      if (isContentsEntry(line)) continue
      inContents = false
    }

    result.push(line)
  }

  return result.join("\n")
}

/** Содержание одной полосой: «СОДЕРЖА Н ИЕ», группы точек и «Введение3». */
function stripFlatContentsBlock(text: string): string {
  const headingRe = new RegExp(String.raw`(^|[^\p{L}\p{N}])(?:${CONTENTS_WORD})(?![\p{L}])`, "giu")
  let result = ""
  let cursor = 0
  for (const match of text.matchAll(headingRe)) {
    if (match.index == null) continue
    const prefixLen = match[1]?.length ?? 0
    const wordAt = match.index + prefixLen
    if (wordAt < cursor) continue
    const end = consumeFlatContentsEntries(text, match.index + match[0].length)
    if (end == null) continue
    result += text.slice(cursor, expandHeadingCut(text, wordAt))
    cursor = end
  }
  result += text.slice(cursor)
  return result
}

function expandHeadingCut(text: string, wordAt: number): number {
  let i = wordAt
  while (i > 0 && /\s/u.test(text[i - 1])) i--
  let j = i
  while (j > 0 && /\d/u.test(text[j - 1])) j--
  if (j < i && i - j <= 4 && (j === 0 || /\s/u.test(text[j - 1]))) return j
  return wordAt
}

function consumeFlatContentsEntries(text: string, from: number): number | null {
  let i = from
  let found = false
  while (i < text.length) {
    let j = i
    while (j < text.length && /\s/u.test(text[j])) j++
    if (j >= text.length) break
    const next = matchOneFlatEntry(text, j)
    if (next == null) break
    i = next
    found = true
  }
  return found ? i : null
}

function isPageNumber(value: string): boolean {
  return /^\d{1,4}$/u.test(value) && !/^(?:19|20)\d{2}$/u.test(value)
}

function readDotLeader(text: string, from: number): { end: number; dots: number } | null {
  let p = from
  let dots = 0
  while (p < text.length) {
    const ch = text[p]
    if (ch === "." || ch === "…") {
      dots++
      p++
      continue
    }
    if (dots > 0 && /\s/u.test(ch)) {
      let q = p
      while (q < text.length && /\s/u.test(text[q])) q++
      if (q < text.length && (text[q] === "." || text[q] === "…")) {
        p = q
        continue
      }
    }
    break
  }
  if (dots < 2) return null
  return { end: p, dots }
}

function matchOneFlatEntry(text: string, start: number): number | null {
  if (start >= text.length || !/[\p{L}\p{N}]/u.test(text[start])) return null
  const windowEnd = Math.min(text.length, start + 900)
  let leaderEnd: number | null = null
  for (let k = start + 1; k < windowEnd; k++) {
    const ch = text[k]
    if (ch !== "." && ch !== "…") continue
    const leader = readDotLeader(text, k)
    if (!leader) continue
    let r = leader.end
    while (r < text.length && /\s/u.test(text[r])) r++
    const page = /^(\d{1,4})(?![\p{L}\p{N}])/u.exec(text.slice(r))
    if (!page || !isPageNumber(page[1])) continue
    const title = text.slice(start, k)
    if (title.length > 300 || /[\p{L}][.!?]\s/u.test(title)) break
    leaderEnd = r + page[1].length
    break
  }

  const slice = text.slice(start, start + 80)
  const glued = /^[\p{L}]{2,}\d{1,4}(?![\p{L}\p{N}])/u.exec(slice)
  const gluedEnd = glued && isPageNumber(glued[0].match(/\d{1,4}$/u)?.[0] || "") ? start + glued[0].length : null
  const spaced = /^[\p{L}\d][^\n]{0,70}?\s(\d{1,4})(?![\p{L}\p{N}])/u.exec(slice)
  let spacedEnd: number | null = null
  if (spaced && isPageNumber(spaced[1]) && !/[\p{L}][.!?…]\s/u.test(spaced[0]) && !/(?:\.\s*){4,}/u.test(spaced[0])) {
    const title = spaced[0].replace(/\s\d{1,4}$/u, "").trim()
    if (!/^глава$/iu.test(title) && !/^(?:глава\s+)?\d+(?:\.\d+)*$/iu.test(title)) {
      spacedEnd = start + spaced[0].length
    }
  }
  const shortEnd = gluedEnd ?? spacedEnd
  if (shortEnd != null && (leaderEnd == null || shortEnd < leaderEnd)) return shortEnd
  return leaderEnd
}

/**
 * Первое настоящее приложение и всё после него: несколько приложений, листинги и код.
 * Номер страницы перед заголовком («151 ПРИЛОЖЕНИЕ Б») тоже относится к приложению.
 * Пункт оглавления «Приложение А .... 25» и «приложение Microsoft Excel» не подходят.
 */
function stripInlineAppendix(text: string): string {
  const heading = /приложени[ея]\s+(?:№\s*)?([\p{L}](?![\p{L}])|\d{1,3}(?!\d))/giu
  for (const match of text.matchAll(heading)) {
    if (match.index == null || !isAppendixMarker(match[1] || "")) continue
    const prev = match.index > 0 ? text[match.index - 1] : ""
    if (prev && /[\p{L}\p{N}_]/u.test(prev)) continue
    const after = text.slice(match.index + match[0].length)
    if (/^\s*[\.…]{2,}/u.test(after)) continue
    const lineEnd = text.indexOf("\n", match.index)
    const line = text.slice(match.index, lineEnd === -1 ? text.length : lineEnd)
    if (hasTrailingPageNumber(line)) continue
    return text.slice(0, pageNumberBefore(text, match.index)).trim()
  }
  return text
}

function pageNumberBefore(text: string, index: number): number {
  let i = index
  while (i > 0 && /\s/u.test(text[i - 1])) i--
  let j = i
  while (j > 0 && /\d/u.test(text[j - 1])) j--
  const digits = text.slice(j, i)
  if (j < i && digits.length <= 4 && isPageNumber(digits) && (j === 0 || /\s/u.test(text[j - 1]))) return j
  return index
}

/**
 * Удаление служебных частей перед проверкой: титул, содержание, приложения,
 * подписи рисунков и таблиц. Главы, введение, ход работы, вывод и заключение остаются.
 */
export function stripNonContentSections(rawText: string): string {
  const withoutTitle = stripTitleBlock(rawText)
  const withoutSections = stripInlineAppendix(stripFlatContentsBlock(stripContentsAndAppendix(withoutTitle)))
  const joined = stripFigureReferences(withoutSections).trim()
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
