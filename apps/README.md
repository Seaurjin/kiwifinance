# Apps

```
@kiwi/api      Fastify REST API over the ledger, the metric engine and reports
@kiwi/web      React + Vite web app
@kiwi/mobile   Expo / React Native, iOS-first
```

## Running it

```bash
pnpm install
pnpm dev          # API on :8787, in-memory ledger, seeded with demo data
pnpm dev:web      # web app on :5173, proxied to the API
pnpm dev:ios      # iOS app — needs a Mac with Xcode
```

`KIWI_DB=./kiwi.db pnpm dev` keeps the data between restarts. There is no
configuration to fill in and no API key: extraction runs through a
deterministic stub (see below), so the whole capture path works offline.

## The one rule both clients follow

**Neither app computes a figure.** Each asks the API for a *fact set* and
renders the blocks it gets back — a metric row, a chart, a table, a narrative
slot. Every number arrives with its unit, its currency, the basis it was
computed under, and the ids of the transactions behind it. Tapping a number
opens exactly those rows.

That is why the two clients cannot disagree with each other or with the tests:
`SGD 474.56` on the web, on the phone and in `metrics.test.ts` is the same
computation, run once, in `@kiwi/metrics`.

It also means adding a report is not a front-end task. A new standard report is
a new Report Spec; both apps render it without changing a line.

## The stub extractor

`createStubExtractor` in `@kiwi/model-router` parses rather than predicts:

```
"lunch 35, taxi 22, ramen 1200 JPY"
  → SGD -35.00  lunch  (restaurants, 75%)
  → SGD -22.00  taxi   (rideshare,   75%)
  → JPY -1200   ramen  (—,           75%)
```

It exists so the capture path — input, extraction, review queue, ledger write,
metric, report — can be exercised and demonstrated before any credential
exists. Its output is stable, so tests assert on it. Everything it produces
lands below the auto-accept bar and waits in the confirmation queue, because a
parser is not a model and its guesses are not facts.

Swapping in a real provider is a routing-table change; nothing above it moves.

## What the iOS app still needs

The screen, the capture flow, the trace sheet and the shared client are
written and typecheck, but it has not been run — this environment has no macOS
or simulator. Before it ships it needs, on a Mac:

- a first `expo run:ios` to generate the native project
- the Share Extension (FR-CAP-05), App Intents (FR-CAP-06) and the WidgetKit
  widget (FR-CAP-07) — all three are Swift targets with no React Native
  equivalent, and all three hand off into the same extract → review → commit
  path the capture bar uses
- on-device testing of the confirmation queue, which is where a capture goes
  when the extractor is unsure
