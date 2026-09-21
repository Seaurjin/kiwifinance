/**
 * ISO 4217 currency codes and their minor-unit exponents.
 *
 * PRD FR-LED-13: all amounts are stored as integers in the currency's minor
 * unit. The exponent is what tells us how many minor units make a major one,
 * so it has to be a property of the currency, never a global constant of 2.
 */

export type CurrencyCode = string;

/**
 * Currencies whose minor-unit exponent is not 2. Everything else defaults to 2.
 * Source: ISO 4217. Extend as markets are added — a wrong exponent silently
 * misstates every amount in that currency by a factor of 100.
 */
const NON_DEFAULT_EXPONENTS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

const CODE_PATTERN = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

export function assertCurrencyCode(value: unknown): asserts value is CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new TypeError(
      `Invalid currency code: ${JSON.stringify(value)}. Expected three uppercase letters (ISO 4217).`,
    );
  }
}

/** How many decimal places this currency's major unit has. */
export function minorUnitExponent(currency: CurrencyCode): number {
  assertCurrencyCode(currency);
  return NON_DEFAULT_EXPONENTS[currency] ?? 2;
}

/** How many minor units make one major unit (100 for USD, 1 for JPY). */
export function minorUnitsPerMajor(currency: CurrencyCode): number {
  return 10 ** minorUnitExponent(currency);
}
