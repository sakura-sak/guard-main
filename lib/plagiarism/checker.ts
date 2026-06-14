/**
 * Main Plagiarism Checker
 * Orchestrates all algorithms for document comparison
 */

import {
  createShingles,
  MinHash,
  LSH,
  jaccardSimilarity,
  findMatchingFragments,
  type MatchingFragment,
} from "./algorithms"

import {
  getDb,
  addDocument as dbAddDocument,
  getDocumentById,
  getAllDocuments,
  getDocumentCount,
  deleteDocument as dbDeleteDocument,
  saveFingerprint,
  getFingerprint,
  saveLSHBuckets,
  findCandidatesByBuckets,
} from "../db"

export interface SimilarDocument {
  documentId: number
  title: string
  author: string | null
  similarity: number
  matchingFragments: MatchingFragment[]
}

export interface CheckResult {
  uniquenessScore: number
  totalDocumentsChecked: number
  candidatesFound: number
  similarDocuments: SimilarDocument[]
  topMatchingFragments: MatchingFragment[]
}

export class PlagiarismChecker {
  private shingleSize: number
  private minHash: MinHash
  private lsh: LSH

  constructor(shingleSize = 5, numHashes = 128, numBands = 16, rowsPerBand = 8) {
    this.shingleSize = shingleSize
    this.minHash = new MinHash(numHashes)
    this.lsh = new LSH(numBands, rowsPerBand)

    // Initialize database
    getDb()
  }

  async addDocument(
    title: string,
    content: string,
    author?: string,
    filename?: string,
    category = "uncategorized",
  ): Promise<number> {
    // Add to database
    const docId = dbAddDocument(title, content, author, filename, category)

    // Create fingerprint
    const shingles = createShingles(content, this.shingleSize)
    const signature = this.minHash.computeSignature(shingles)

    // Save fingerprint
    saveFingerprint(docId, signature, shingles.size)

    // Save LSH buckets
    const buckets = this.lsh.getBuckets(signature)
    saveLSHBuckets(docId, buckets)

    return docId
  }

  async checkDocument(content: string, topK = 5): Promise<CheckResult> {
    // Create fingerprint for query document
    const shingles = createShingles(content, this.shingleSize)
    const signature = this.minHash.computeSignature(shingles)

    // Find candidates using LSH
    const buckets = this.lsh.getBuckets(signature)
    const candidateIds = findCandidatesByBuckets(buckets)

    const totalDocs = getDocumentCount()

    if (candidateIds.length === 0) {
      return {
        uniquenessScore: 100,
        totalDocumentsChecked: totalDocs,
        candidatesFound: 0,
        similarDocuments: [],
        topMatchingFragments: [],
      }
    }

    // Compute similarities for candidates
    const results: SimilarDocument[] = []

    for (const docId of candidateIds) {
      const doc = getDocumentById(docId)
      const fingerprint = getFingerprint(docId)

      if (!doc || !fingerprint) continue

      // Estimate similarity from signatures
      const estimatedSim = this.minHash.estimateSimilarity(signature, fingerprint.signature)

      if (estimatedSim > 0.2) {
        // Compute exact Jaccard for promising candidates
        const docShingles = createShingles(doc.content, this.shingleSize)
        const exactSim = jaccardSimilarity(shingles, docShingles)

        // Find matching fragments
        const fragments = findMatchingFragments(content, doc.content)

        results.push({
          documentId: doc.id,
          title: doc.title,
          author: doc.author,
          similarity: Math.round(exactSim * 10000) / 100, // percentage with 2 decimals
          matchingFragments: fragments.slice(0, 5),
        })
      }
    }

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity)
    const topResults = results.slice(0, topK)

    // Calculate uniqueness
    const maxSimilarity = topResults.length > 0 ? topResults[0].similarity : 0
    const uniqueness = Math.round((100 - maxSimilarity) * 100) / 100

    return {
      uniquenessScore: uniqueness,
      totalDocumentsChecked: totalDocs,
      candidatesFound: candidateIds.length,
      similarDocuments: topResults,
      topMatchingFragments: topResults.length > 0 ? topResults[0].matchingFragments : [],
    }
  }

  getDocuments() {
    return getAllDocuments()
  }

  getDocumentCount() {
    return getDocumentCount()
  }

  deleteDocument(id: number) {
    return dbDeleteDocument(id)
  }
}

// Singleton instance
let checker: PlagiarismChecker | null = null

export function getChecker(): PlagiarismChecker {
  if (!checker) {
    checker = new PlagiarismChecker()
  }
  return checker
}
