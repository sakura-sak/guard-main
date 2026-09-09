import { describe, expect, it } from "vitest"
import { CATEGORY_LABELS, categoryLabel } from "@/lib/category-labels"

describe("categoryLabel", () => {
  it("returns Russian labels for known slugs", () => {
    expect(categoryLabel("lab")).toBe("Лабораторная работа")
    expect(categoryLabel("diploma")).toBe(CATEGORY_LABELS.diploma)
  })

  it("falls back for empty or unknown category", () => {
    expect(categoryLabel()).toBe("Не указано")
    expect(categoryLabel("custom_type")).toBe("custom_type")
  })
})
