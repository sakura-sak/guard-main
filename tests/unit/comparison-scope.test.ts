import { describe, expect, it } from "vitest"
import { comparisonCategories, shouldFinalizeImmediately } from "@/lib/comparison-scope"

describe("comparisonCategories", () => {
  it("puts coursework and diploma in one pool", () => {
    expect(comparisonCategories("coursework")).toEqual(["coursework", "diploma"])
    expect(comparisonCategories("diploma")).toEqual(["coursework", "diploma"])
  })

  it("keeps lab, practice and article as their own pool", () => {
    expect(comparisonCategories("lab")).toEqual(["lab"])
    expect(comparisonCategories("practice")).toEqual(["practice"])
    expect(comparisonCategories("article")).toEqual(["article"])
    expect(comparisonCategories("ipr")).toEqual(["ipr"])
  })

  it("normalizes dirty slugs the same way as upload", () => {
    expect(comparisonCategories("lab!!!")).toEqual(["lab___"])
  })

  it("compares a SEO work with every category of the institution", () => {
    expect(comparisonCategories("seo")).toBeNull()
  })

  it("finalizes Moodle submissions immediately and keeps site drafts", () => {
    expect(shouldFinalizeImmediately("lab", "moodle")).toBe(true)
    expect(shouldFinalizeImmediately("seo", null)).toBe(true)
    expect(shouldFinalizeImmediately("lab", null)).toBe(false)
  })
})
