import { describe, expect, it } from "vitest"
import { comparisonCategories } from "@/lib/comparison-scope"

describe("comparisonCategories", () => {
  it("puts coursework and diploma in one pool", () => {
    expect(comparisonCategories("coursework")).toEqual(["coursework", "diploma"])
    expect(comparisonCategories("diploma")).toEqual(["coursework", "diploma"])
  })

  it("keeps lab, practice and article as their own pool", () => {
    expect(comparisonCategories("lab")).toEqual(["lab"])
    expect(comparisonCategories("practice")).toEqual(["practice"])
    expect(comparisonCategories("article")).toEqual(["article"])
  })

  it("normalizes dirty slugs the same way as upload", () => {
    expect(comparisonCategories("lab!!!")).toEqual(["lab___"])
  })
})
