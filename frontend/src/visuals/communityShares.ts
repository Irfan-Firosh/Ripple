// Largest remainder keeps the displayed shares consistent and summing to 100%.
export function percentShares(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total) return sizes.map(() => 0);
  const raw = sizes.map(n => n / total * 100), out = raw.map(Math.floor);
  const order = raw.map((value, index) => [value - Math.floor(value), index] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - out.reduce((a, b) => a + b, 0);
  for (let index = 0; index < missing; index++) out[order[index % order.length][1]] += 1;
  return out;
}
