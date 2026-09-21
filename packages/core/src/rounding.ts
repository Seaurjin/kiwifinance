/**
 * Rounding used wherever a non-integer amount has to become minor units.
 *
 * Every rounding in the ledger is explicit: there is no implicit `Math.round`
 * anywhere in the money path, because the mode chosen changes reported totals.
 */

export type RoundingMode =
  /** Ties go to the even neighbour. No systematic bias — the default for FX. */
  | 'half-even'
  /** Ties go away from zero. What most card statements do. */
  | 'half-up'
  /** Toward negative infinity. */
  | 'floor'
  /** Toward positive infinity. */
  | 'ceil'
  /** Toward zero. */
  | 'trunc';

export const DEFAULT_ROUNDING: RoundingMode = 'half-even';

export function round(value: number, mode: RoundingMode = DEFAULT_ROUNDING): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round a non-finite value: ${value}`);
  }

  switch (mode) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'trunc':
      return Math.trunc(value);
    case 'half-up': {
      // Math.round breaks ties toward +Infinity, which is not symmetric for
      // negative values (-0.5 would become -0 rather than -1).
      return value < 0 ? -Math.round(-value) : Math.round(value);
    }
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
  }
}
