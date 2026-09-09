/**
 * Split `total` into N parts proportional to `weights`, using the largest-remainder
 * method so the parts sum exactly to `total` (within `decimals` precision).
 */
export function allocatePercents(
  weights: number[],
  total: number,
  decimals = 1,
): number[] {
  const n = weights.length
  if (n === 0) return []

  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.min(100, total)) : 0
  const factor = 10 ** Math.max(0, Math.min(4, Math.floor(decimals)))
  const targetUnits = Math.round(safeTotal * factor)

  if (targetUnits <= 0) return weights.map(() => 0)

  const positive = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const sumW = positive.reduce((a, b) => a + b, 0)
  const effective = sumW > 0 ? positive : weights.map(() => 1)
  const sumEff = effective.reduce((a, b) => a + b, 0)

  const exact = effective.map((w) => (w / sumEff) * targetUnits)
  const floors = exact.map((x) => Math.floor(x + 1e-9))
  let leftover = targetUnits - floors.reduce((a, b) => a + b, 0)

  const byFrac = exact
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const units = [...floors]
  for (let k = 0; k < leftover && k < byFrac.length; k++) {
    units[byFrac[k].i] += 1
  }

  return units.map((u) => u / factor)
}
