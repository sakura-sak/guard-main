/**
 * Which document categories form one comparison pool.
 * Default: 1 slug → 1 pool. Exception: coursework + diploma together.
 * New types from document_types catalog work automatically (1:1).
 */

import { normalizeCategorySlug } from "./document-types"

const GRADUATION_TYPES = new Set(["coursework", "diploma"])

export function comparisonCategories(category: string): string[] {
  const slug = normalizeCategorySlug(category)
  if (GRADUATION_TYPES.has(slug)) return ["coursework", "diploma"]
  return [slug]
}
