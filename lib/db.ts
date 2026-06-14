/**
 * In-memory database for plagiarism detection system
 * Uses a simple in-memory store that persists during server runtime
 */

// Types
export interface Document {
  id: number
  title: string
  author: string | null
  filename: string | null
  content: string
  word_count: number
  upload_date: string
  category: string
}

export interface DocumentSummary {
  id: number
  title: string
  author: string | null
  filename: string | null
  word_count: number
  upload_date: string
  category: string
}

interface Fingerprint {
  documentId: number
  signature: number[]
  numShingles: number
}

interface LSHBucket {
  bandId: number
  bucketHash: string
  documentId: number
}

// In-memory storage
const store = {
  documents: new Map<number, Document>(),
  fingerprints: new Map<number, Fingerprint>(),
  lshBuckets: [] as LSHBucket[],
  nextId: 1,
}

export function getDb() {
  return store
}

export function getAllDocuments(): DocumentSummary[] {
  return Array.from(store.documents.values())
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      author: doc.author,
      filename: doc.filename,
      word_count: doc.word_count,
      upload_date: doc.upload_date,
      category: doc.category,
    }))
    .sort((a, b) => new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime())
}

export function getDocumentById(id: number): Document | null {
  return store.documents.get(id) || null
}

export function getDocumentCount(): number {
  return store.documents.size
}

export function addDocument(
  title: string,
  content: string,
  author?: string,
  filename?: string,
  category = "uncategorized",
): number {
  const id = store.nextId++
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length

  const doc: Document = {
    id,
    title,
    author: author || null,
    filename: filename || null,
    content,
    word_count: wordCount,
    upload_date: new Date().toISOString(),
    category,
  }

  store.documents.set(id, doc)
  return id
}

export function deleteDocument(id: number): boolean {
  // Delete related data
  store.fingerprints.delete(id)
  store.lshBuckets = store.lshBuckets.filter((b) => b.documentId !== id)

  return store.documents.delete(id)
}

export function saveFingerprint(documentId: number, signature: number[], numShingles: number) {
  store.fingerprints.set(documentId, { documentId, signature, numShingles })
}

export function getFingerprint(documentId: number): { signature: number[]; numShingles: number } | null {
  const fp = store.fingerprints.get(documentId)
  if (!fp) return null
  return { signature: fp.signature, numShingles: fp.numShingles }
}

export function saveLSHBuckets(documentId: number, buckets: { bandId: number; hash: string }[]) {
  for (const bucket of buckets) {
    store.lshBuckets.push({
      bandId: bucket.bandId,
      bucketHash: bucket.hash,
      documentId,
    })
  }
}

export function findCandidatesByBuckets(buckets: { bandId: number; hash: string }[]): number[] {
  const candidates = new Set<number>()

  for (const bucket of buckets) {
    for (const stored of store.lshBuckets) {
      if (stored.bandId === bucket.bandId && stored.bucketHash === bucket.hash) {
        candidates.add(stored.documentId)
      }
    }
  }

  return Array.from(candidates)
}
