// Normalize SpacetimeDB microsecond timestamps, while accepting millisecond epoch values.
export function experimentDate(createdAt: number): Date {
  return new Date(Math.abs(createdAt) >= 100_000_000_000_000 ? createdAt / 1000 : createdAt);
}
