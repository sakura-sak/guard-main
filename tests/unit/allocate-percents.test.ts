import { describe, expect, it } from "vitest"
import { allocatePercents } from "@/lib/allocate-percents"

describe("allocatePercents", () => {
  it("returns empty array for empty weights", () => {
    expect(allocatePercents([], 18.3)).toEqual([])
  })

  it("returns zeros when total is zero", () => {
    expect(allocatePercents([10, 20], 0)).toEqual([0, 0])
  })

  it("splits total proportionally so parts sum to the target", () => {
    const parts = allocatePercents([12.5, 6.2], 18.3, 1)
    const sum = parts.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(18.3, 1)
    expect(parts[0]).toBeGreaterThan(parts[1])
  })

  it("clamps total to 0..100", () => {
    const over = allocatePercents([1], 150, 1)
    expect(over[0]).toBe(100)
    const under = allocatePercents([1], -10, 1)
    expect(under[0]).toBe(0)
  })

  it("treats non-positive weights as equal shares when all are invalid", () => {
    const parts = allocatePercents([0, 0], 10, 1)
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 1)
  })
})
