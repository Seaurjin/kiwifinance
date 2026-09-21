# Apps

```
@kiwi/api      Fastify REST API over the ledger, the metric engine and reports
@kiwi/mcp      Remote MCP server — the user's own AI, reading their own ledger
@kiwi/web      React + Vite web app
@kiwi/mobile   Expo / React Native, iOS-first
```

## Running it

```bash
pnpm install
pnpm dev          # API on :8787, in-memory ledger, seeded with demo data
pnpm dev:web      # web app on :5173, proxied to the API
pnpm dev:ios      # iOS app — needs a Mac with Xcode
pnpm dev:mcp      # MCP server on :8788/mcp
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

## The MCP server

`pnpm dev:mcp` serves seven tools at `http://localhost:8788/mcp` over Streamable
HTTP. Two demo tokens: `demo-read` and `demo-write`.

```
kiwi_list_schema         read-only   accounts, categories, currencies, every
                                     metric and report that exists
kiwi_query_transactions  read-only   individual rows, capped at 200
kiwi_run_metric          read-only   one named figure, with its sources
kiwi_run_report          read-only   a standard report or an ad-hoc spec
kiwi_search_receipts     read-only   what has an original behind it
kiwi_add_transaction     WRITE       lands in the confirmation queue
kiwi_save_report         WRITE       stores a spec to re-run
```

Four things are enforced rather than documented:

- **Read-only unless the owner says otherwise.** A write tool on a read-only
  connection refuses and says why.
- **Anything an outside AI writes waits for a human.** It goes to the
  confirmation queue and moves no figure until accepted.
- **Every call is logged** — `store.recordMcpAccess` — and the log reads in
  plain words: *"claude-desktop read 218 transactions between 2026-03-01 and
  2026-03-31"*. The web app shows it.
- **Internal ids stay behind.** A row that leaves carries an account *name*; a
  receipt says what kind of original it has, never where it is stored. Pages
  cap at 200 rows and say when they capped.

The server's `instructions` tell a connecting model to call `kiwi_list_schema`
first and never to add up rows itself — figures come from `kiwi_run_metric` or
`kiwi_run_report`, which return them with the transactions behind them.

Authentication is a scoped bearer token. **OAuth 2.1 with PKCE and dynamic
client registration (FR-OPN-04) is not built** — it needs a deployed
authorisation server. The scope model, the read-only default and the audit
trail, which are what decide what an outside AI can actually do, are in place
and tested.

## Asking for a report

`POST /api/ledgers/:id/reports/plan` takes `{ "question": "…" }` and answers
with the **plan and the figures in one round trip**. The plan comes first on
screen, deliberately: the period the planner settled on, every filter it
applied, and anything in the question it could not answer, before a single
number. A number whose question you cannot see is a number you have to trust.

The API defaults to the deterministic `TemplatePlanner`, so this works with no
credential. `buildServer({ planner })` takes a `RouterPlanner` instead once a
provider key exists; nothing else in the API changes, and a model's spec is
validated exactly as hard as a hand-written one.

## Exporting a report as a Skill

`GET /api/ledgers/:id/reports/:reportId/skill` returns a three-file bundle:
`SKILL.md` (agentskills.io frontmatter), `spec.json`, `README.md`. The spec
travels; the figures do not. The SKILL.md tells the receiving agent to call
`kiwi_run_report` and states the rule that makes it safe: *every number you
write must appear in the fact set*.

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
