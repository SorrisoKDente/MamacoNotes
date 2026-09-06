/**
 * ponytail: centralized math utilities.
 */

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
