# Packages

The deterministic core of Kiwi Finance. Everything here is pure TypeScript with
no IO, no clock and no network, which is what lets the whole layer be tested
without an API key and makes a report reproducible.

```
@kiwi/core          money · currency · FX · calendar periods
@kiwi/ledger        entities · invariants · SQL schema · seed categories · golden dataset
@kiwi/metrics       the metric registry — the only producer of numbers
@kiwi/report-spec   the spec contract, its executor, and the narrator guard
@kiwi/model-router  task contracts and provider routing
@kiwi/store         SQLite persistence on node:sqlite
@kiwi/client        API client and formatters, shared by both apps
```

## The dependency direction

```
core  ←  ledger  ←  metrics  ←  report-spec
                                model-router (independent)
```

Nothing depends on `report-spec`, and `model-router` depends on nothing, so a
model can be swapped or a provider added without touching a figure.

## Where the PRD principles live in code

| Principle | Enforced by |
|---|---|
| **P-1** Numbers never come from the model | `metrics/` is the only place a figure is produced; `report-spec/narrator-guard.ts` rejects a narrative citing anything else; `report-spec/validate.ts` rejects a spec naming a metric that does not exist |
| **P-2** Multi-currency is the foundation | `core/currency.ts` (per-currency minor units), `core/fx.ts` (frozen conversions, two rate bases), `ledger/invariants.ts` (a stored base amount must be reproducible from its stored rate) |
| **P-3** The user's data is theirs | `ledger/schema.sql` — soft delete plus an append-only event log, so nothing is unrecoverable |

## Running it

```bash
pnpm install
pnpm test        # 211 tests
pnpm typecheck
```

## The golden dataset

`@kiwi/ledger`'s `demoSnapshot()` is one small multi-currency ledger whose every
figure can be checked by hand. It deliberately contains a JPY amount (no minor
unit), a transfer pair, an FX trade pair, an uncategorised row, a row awaiting
confirmation and a soft-deleted row — each of these has broken a ledger
somewhere. Metric tests assert against numbers derived from it on paper, so a
failing test means the engine changed its mind about what a number means, not
that a fixture drifted.

## What is deliberately missing

No database driver, no HTTP client, no provider SDK. `model-router` defines the
adapter interface and ships none: wiring a real provider is a Phase 1 task that
needs credentials and an evaluation set, and keeping it out means this layer
stays runnable and testable by anyone who clones the repo.
