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

/**
 * Черновое удаление служебных разделов документа
 * (титульный лист, содержание/оглавление, приложения)
 * перед расчётом оригинальности.
 *
 * Предполагается, что приложения находятся в конце документа:
 * всё, что идёт после заголовка «Приложение», исключается.
 */
export function stripNonContentSections(rawText: string): string {
  const lines = rawText.split(/\r?\n/)
  const result: string[] = []

  let inAppendix = false

  for (const line of lines) {
    const trimmed = line.trim()
    const lower = trimmed.toLowerCase()

    // Если начались приложения — всё, что дальше, игнорируем
    if (!inAppendix && /^приложение\b/i.test(trimmed)) {
      inAppendix = true
      continue
    }
    if (inAppendix) {
      continue
    }

    // Удаляем строки‑заголовки «Содержание» / «Оглавление»
    if (/^\s*содержание\s*$/i.test(line) || /^\s*оглавление\s*$/i.test(line)) {
      continue
    }

    // Удаляем явные упоминания титульного листа
    if (lower.includes("титульный лист")) {
      continue
    }

    result.push(line)
  }

  const joined = result.join("\n").trim()
  // На всякий случай: если после очистки текста почти нет, возвращаем исходный
  if (joined.length < 50) {
    return rawText
  }

  return joined
}

/**
 * Нормализация текста для проверки на плагиат.
 * Здесь можно добавлять более сложные правила предобработки.
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
