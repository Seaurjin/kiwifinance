/**
 * A deterministic stand-in for a real provider.
 *
 * It exists so the whole capture path — input, extraction, confirmation
 * queue, ledger write, metric, report — can be exercised and demonstrated
 * before any credential exists. It parses rather than predicts, so its output
 * is stable and a test can assert on it.
 *
 * It handles the shape of input that matters most for the demo: one sentence
 * describing several purchases (FR-CAP-04). Swapping in a real adapter later
 * changes nothing above it, which is the point of the router.
 */

import type { AdapterRequest, AdapterResponse, ProviderAdapter } from './router.ts';

export interface StubExtractorOptions {
  /** Currency assumed when the text names none. */
  readonly baseCurrency: string;
  /** Date assumed when the text names none. */
  readonly today: string;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  '¥': 'CNY',
  '￥': 'CNY',
  '$': 'USD',
  'S$': 'SGD',
  '€': 'EUR',
  '£': 'GBP',
  '₩': 'KRW',
};

const SEGMENT_SEPARATORS = /[,，;；、\n]+|\band\b/gi;
const AMOUNT = /(-?\d+(?:[.,]\d+)?)/;
const CURRENCY_CODE = /\b(SGD|USD|CNY|JPY|EUR|GBP|HKD|TWD|KRW|MYR|THB|AUD|CAD)\b/i;

/** Currencies whose minor unit is the major unit; see @kiwi/core. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

interface Draft {
  amountMinor: number;
  currency: string;
  date: string;
  merchantName: string | null;
  categorySlug: string | null;
  note: string | null;
  confidence: number;
}

/** Words that hint at a category without needing a model. */
const CATEGORY_HINTS: readonly [RegExp, string][] = [
  [/coffee|latte|咖啡|星巴克/i, 'coffee'],
  [/lunch|dinner|breakfast|午饭|晚饭|早饭|吃饭|restaurant/i, 'restaurants'],
  [/grocer|supermarket|超市|菜|fairprice|hema/i, 'groceries'],
  [/taxi|uber|grab|didi|打车|滴滴|rideshare/i, 'rideshare'],
  [/train|mrt|metro|bus|地铁|公交/i, 'public-transit'],
  [/flight|airline|机票|航班/i, 'flights'],
  [/hotel|酒店|住宿/i, 'accommodation'],
  [/water|drink|买水|零食|snack/i, 'groceries'],
];

function detectCurrency(segment: string, fallback: string): string {
  const code = CURRENCY_CODE.exec(segment);
  if (code?.[1] !== undefined) return code[1].toUpperCase();
  for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
    if (segment.includes(symbol)) return currency;
  }
  return fallback;
}

function detectCategory(segment: string): string | null {
  for (const [pattern, slug] of CATEGORY_HINTS) {
    if (pattern.test(segment)) return slug;
  }
  return null;
}

function toMinorUnits(amountMajor: number, currency: string): number {
  const factor = ZERO_DECIMAL.has(currency) ? 1 : 100;
  return Math.round(amountMajor * factor);
}

function cleanMerchant(segment: string): string | null {
  const words = segment
    .replace(AMOUNT, ' ')
    .replace(CURRENCY_CODE, ' ')
    .replace(/[¥￥$€£₩]|块|元|bucks?|dollars?|for|on|at|spent|paid/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words.length === 0 ? null : words.slice(0, 80);
}

export function parseCaptureText(text: string, options: StubExtractorOptions): Draft[] {
  return text
    .split(SEGMENT_SEPARATORS)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => {
      const match = AMOUNT.exec(segment);
      if (match?.[1] === undefined) return [];

      const amountMajor = Number(match[1].replace(',', '.'));
      if (!Number.isFinite(amountMajor) || amountMajor === 0) return [];

      const currency = detectCurrency(segment, options.baseCurrency);
      const merchant = cleanMerchant(segment);

      return [
        {
          // Everything captured this way is money going out unless it says so.
          amountMinor: -Math.abs(toMinorUnits(amountMajor, currency)),
          currency,
          date: options.today,
          merchantName: merchant,
          categorySlug: detectCategory(segment),
          note: null,
          // Deliberately below a sensible auto-accept bar: a parser is not a
          // model, and its guesses belong in the confirmation queue.
          confidence: merchant === null ? 0.55 : 0.75,
        },
      ];
    });
}

export function createStubExtractor(options: StubExtractorOptions): ProviderAdapter {
  return {
    id: 'stub',
    async invoke(request: AdapterRequest): Promise<AdapterResponse> {
      if (request.contract.name !== 'extract') {
        throw new Error(`The stub adapter only implements extraction, not "${request.contract.name}".`);
      }
      const input = request.input as { text?: unknown };
      const text = typeof input.text === 'string' ? input.text : '';
      return { output: { drafts: parseCaptureText(text, options) }, costUsd: 0 };
    },
  };
}
