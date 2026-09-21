# Packages

The deterministic core of Kiwi Finance. Everything here is pure TypeScript with
no IO, no clock and no network, which is what lets the whole layer be tested
without an API key and makes a report reproducible.

```
@kiwi/core          money · currency · FX · calendar periods
@kiwi/ledger        entities · invariants · SQL schema · seed categories · golden dataset
@kiwi/metrics       the metric registry — the only producer of numbers
@kiwi/report-spec   the spec contract, its executor, and the narrator guard
@kiwi/planner       plain language in, Report Spec out
@kiwi/model-router  task contracts and provider routing
@kiwi/store         SQLite persistence on node:sqlite
@kiwi/client        API client and formatters, shared by both apps
```

## The dependency direction

```
core  ←  ledger  ←  metrics  ←  report-spec  ←  planner
                                model-router  ←  planner
```

Only the planner depends on both halves, and it depends on them the safe way
round: it may choose metrics, and it may not compute one. A model can be
swapped or a provider added without touching a figure.

## Where the PRD principles live in code

| Principle | Enforced by |
|---|---|
| **P-1** Numbers never come from the model | `metrics/` is the only place a figure is produced; `report-spec/narrator-guard.ts` rejects a narrative citing anything else; `report-spec/validate.ts` rejects a spec naming a metric that does not exist; `planner/` turns a question into a spec and never into an answer |
| **P-2** Multi-currency is the foundation | `core/currency.ts` (per-currency minor units), `core/fx.ts` (frozen conversions, two rate bases), `ledger/invariants.ts` (a stored base amount must be reproducible from its stored rate) |
| **P-3** The user's data is theirs | `ledger/schema.sql` — soft delete plus an append-only event log, so nothing is unrecoverable |

## Running it

```bash
pnpm install
pnpm test        # 273 tests
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

## Asking for a report

`@kiwi/planner` maps a question — in English or Chinese — onto the metrics
that answer it, resolves the period, and hands back a spec plus a list of
everything it decided for you: the window it assumed, the filters it applied,
and anything in the question it could not answer. It refuses to forecast,
because nothing in `metrics/` can.

```
"subscriptions and anything unusual over the last 12 months"
  → period 2025-10-01 … 2026-09-30
  → subscription_total, expense_total, rolling_avg
  → recurring_detected, price_increase_alert, large_anomalies
  → narrative(subscriptions, summary, anomalies)
```

Two producers, one contract. `TemplatePlanner` is deterministic and needs no
credential; `RouterPlanner` asks a model through `@kiwi/model-router` and
validates the answer with `parseSpec` — an invalid spec is discarded, never
repaired, and the template planner answers instead. The user is told which one
answered.

## What is deliberately missing

No database driver, no HTTP client, no provider SDK. `model-router` defines the
adapter interface and ships none: wiring a real provider is a Phase 1 task that
needs credentials and an evaluation set, and keeping it out means this layer
stays runnable and testable by anyone who clones the repo.
