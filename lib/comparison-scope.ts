/**
 * Which document categories form one comparison pool.
 * Default: 1 slug → 1 pool. Exception: coursework + diploma together.
 * New types from document_types catalog work automatically (1:1).
 */

import { normalizeCategorySlug } from "./document-types"

const GRADUATION_TYPES = new Set(["coursework", "diploma"])

/** Works submitted from Moodle. Compared with every category of the same institution. */
export const SEO_CATEGORY = "seo"

export function isSeoCategory(category: string | null | undefined): boolean {
  return normalizeCategorySlug(category || "") === SEO_CATEGORY
}

/**
 * Categories that form one comparison pool.
 * `null` means no category filter: a SEO work is compared with the whole institution.
 */
export function comparisonCategories(category: string): string[] | null {
  const slug = normalizeCategorySlug(category)
  if (slug === SEO_CATEGORY) return null
  if (GRADUATION_TYPES.has(slug)) return ["coursework", "diploma"]
  return [slug]
}
