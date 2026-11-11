/**
 * Earlier works of the same author. Shown in the full report only.
 * They are excluded from the plagiarism percent (comparison skips the same user).
 */

import { compareMinHashSignatures } from "@/lib/plagiarism/algorithms"
import { prisma } from "@/lib/prisma"

const NUM_HASHES = 128

export type OwnPreviousWork = {
  id: number
  title: string
  similarity: number
  uploadDate: string | null
}

export async function listOwnPreviousWorks(doc: {
  id: number
  userId?: string | null
  minhashSignature?: number[] | null
}): Promise<OwnPreviousWork[]> {
  const userId = doc.userId?.trim()
  const signature = doc.minhashSignature
  if (!userId || !Array.isArray(signature) || signature.length !== NUM_HASHES) return []

  const rows = await prisma.document.findMany({
    where: {
      userId,
      id: { not: doc.id },
      status: { in: ["draft", "final"] },
    },
    select: {
      id: true,
      title: true,
      uploadDate: true,
      signaturePayload: { select: { minhash: true } },
    },
    orderBy: { uploadDate: "desc" },
    take: 20,
  })

  return rows
    .map((row) => {
      const other = row.signaturePayload?.minhash
      if (!Array.isArray(other) || other.length !== NUM_HASHES) return null
      const similarity = Math.round(compareMinHashSignatures(signature, other) * 100)
      if (similarity < 10) return null
      return {
        id: row.id,
        title: row.title || "—",
        similarity,
        uploadDate: row.uploadDate ? row.uploadDate.toISOString() : null,
      }
    })
    .filter((row): row is OwnPreviousWork => row !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
}
