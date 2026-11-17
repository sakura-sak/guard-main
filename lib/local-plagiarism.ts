/**
 * Fast local MinHash plagiarism against institution corpus.
 * Used at upload time so async ML completion can still use max(local, ml).
 */

import {
  createShingles,
  MinHash,
  compareMinHashSignatures,
} from "@/lib/plagiarism/algorithms"
import { getDocumentsForComparison } from "@/lib/local-storage"

const NUM_HASHES = 128
const LOCAL_SIMILARITY_THRESHOLD = 10

function roundPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100
}

/**
 * MinHash всего текста завышает похожесть примерно на 23 пункта даже у оригинала:
 * наблюдаемое s ≈ база + (1 − база) × настоящая доля. Возвращаем оценку настоящей доли.
 * LOCAL_PLAGIARISM_BASE=0 отключает поправку.
 */
export function adjustLocalPlagiarismPercent(rawPercent: number): number {
  const rawBase = Number(String(process.env.LOCAL_PLAGIARISM_BASE ?? "23").replace(",", "."))
  const base = Number.isFinite(rawBase) ? Math.min(99, Math.max(0, rawBase)) : 23
  if (base <= 0) return roundPercent(rawPercent)
  const adjusted = ((rawPercent / 100 - base / 100) / (1 - base / 100)) * 100
  return roundPercent(Math.max(0, adjusted))
}

export async function computeLocalPlagiarismPercent(
  normalizedContent: string,
  signature: number[],
  category: string,
  institutionId?: string | null,
  excludeUserId?: string | null,
): Promise<number> {
  if (!institutionId?.trim() || !Array.isArray(signature) || signature.length !== NUM_HASHES) {
    return 0
  }
  const pool = await getDocumentsForComparison(category, institutionId, undefined, excludeUserId)
  let best = 0
  for (const doc of pool) {
    if (!Array.isArray(doc.minhashSignature) || doc.minhashSignature.length !== NUM_HASHES) continue
    const similarity = roundPercent(compareMinHashSignatures(signature, doc.minhashSignature) * 100)
    if (similarity >= LOCAL_SIMILARITY_THRESHOLD && similarity > best) best = similarity
  }
  return adjustLocalPlagiarismPercent(best)
}

export function computeMinHashSignature(normalizedContent: string): {
  shingles: Set<string>
  signature: number[]
} {
  const shingles = createShingles(normalizedContent, 5)
  const signature = new MinHash(NUM_HASHES).computeSignature(shingles)
  return { shingles, signature }
}
