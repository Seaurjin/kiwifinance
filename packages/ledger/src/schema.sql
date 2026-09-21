-- Kiwi Finance — local ledger schema (SQLite).
--
-- Conventions that the whole system depends on:
--   * Every amount is an INTEGER count of the currency's minor unit (FR-LED-13).
--     There is no REAL column holding money anywhere in this file.
--   * Nothing is hard deleted. `deleted_at` hides a row and `event_log` keeps
--     the trail, so a vanished record is always recoverable (FR-LED-12).
--   * Every transaction freezes its own FX conversion. Readers use
--     `base_amount_minor`; nothing recomputes a historical rate (FR-LED-03).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  base_currency       TEXT NOT NULL,
  reporting_currency  TEXT,
  created_at          TEXT NOT NULL,
  deleted_at          TEXT,
  CHECK (length(base_currency) = 3),
  CHECK (reporting_currency IS NULL OR length(reporting_currency) = 3)
);

CREATE TABLE IF NOT EXISTS account (
  id                    TEXT PRIMARY KEY,
  ledger_id             TEXT NOT NULL REFERENCES ledger(id),
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('cash','debit','credit','savings')),
  currency              TEXT NOT NULL CHECK (length(currency) = 3),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  archived_at           TEXT,
  deleted_at            TEXT
);

CREATE INDEX IF NOT EXISTS account_by_ledger ON account(ledger_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS category (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT REFERENCES ledger(id),
  parent_id  TEXT REFERENCES category(id),
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('expense','income')),
  essential  INTEGER NOT NULL DEFAULT 0 CHECK (essential IN (0,1)),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS category_by_parent ON category(parent_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS merchant (
  id                  TEXT PRIMARY KEY,
  ledger_id           TEXT NOT NULL REFERENCES ledger(id),
  normalized_name     TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  default_category_id TEXT REFERENCES category(id),
  deleted_at          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_unique_name
  ON merchant(ledger_id, normalized_name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS provenance (
  id           TEXT PRIMARY KEY,
  ledger_id    TEXT NOT NULL REFERENCES ledger(id),
  kind         TEXT NOT NULL CHECK (kind IN ('screenshot','photo','email','api','voice','bank')),
  ref          TEXT NOT NULL,
  captured_at  TEXT NOT NULL,
  extracted_by TEXT,
  deleted_at   TEXT
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS txn (
  id                TEXT PRIMARY KEY,
  ledger_id         TEXT NOT NULL REFERENCES ledger(id),
  account_id        TEXT NOT NULL REFERENCES account(id),
  kind              TEXT NOT NULL
                      CHECK (kind IN ('expense','income','transfer','fx_trade','adjustment')),
  date              TEXT NOT NULL,

  -- Frozen FX columns. Written once, never recomputed (FR-LED-01/02/03).
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL CHECK (length(currency) = 3),
  fx_rate           REAL NOT NULL CHECK (fx_rate > 0),
  fx_rate_source    TEXT NOT NULL
                      CHECK (fx_rate_source IN ('card_statement','ecb','provider','manual')),
  fx_as_of          TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL,
  base_currency     TEXT NOT NULL CHECK (length(base_currency) = 3),

  category_id       TEXT REFERENCES category(id),
  merchant_id       TEXT REFERENCES merchant(id),
  merchant_name     TEXT,
  note              TEXT,
  tags              TEXT NOT NULL DEFAULT '[]',

  link_id           TEXT,
  parent_id         TEXT REFERENCES txn(id),

  source            TEXT NOT NULL
                      CHECK (source IN ('manual','screenshot','photo','voice','email','api','bank')),
  source_hash       TEXT,
  ai_confidence     REAL CHECK (ai_confidence IS NULL OR (ai_confidence BETWEEN 0 AND 1)),
  provenance_id     TEXT REFERENCES provenance(id),
  status            TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed','pending_review')),

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,

  -- Sign convention: outflows negative, inflows positive.
  CHECK (kind <> 'expense' OR amount_minor <= 0),
  CHECK (kind <> 'income'  OR amount_minor >= 0),
  -- A same-currency transaction cannot carry a rate other than 1.
  CHECK (currency <> base_currency OR (fx_rate = 1.0 AND amount_minor = base_amount_minor)),
  -- Both legs of a transfer or FX trade must be linked.
  CHECK (kind NOT IN ('transfer','fx_trade') OR link_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS txn_by_date      ON txn(ledger_id, date)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS txn_by_category  ON txn(ledger_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS txn_by_account   ON txn(ledger_id, account_id)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS txn_by_status    ON txn(ledger_id, status)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS txn_by_link      ON txn(link_id)                WHERE link_id IS NOT NULL;

-- Re-importing the same screenshot must not create a second row (FR-CAP-12).
CREATE UNIQUE INDEX IF NOT EXISTS txn_source_hash_unique
  ON txn(ledger_id, source_hash) WHERE source_hash IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS category_rule (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES ledger(id),
  match_type  TEXT NOT NULL
                CHECK (match_type IN ('merchant_exact','merchant_contains','note_contains')),
  pattern     TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES category(id),
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS rule_by_ledger
  ON category_rule(ledger_id, priority DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS budget (
  id             TEXT PRIMARY KEY,
  ledger_id      TEXT NOT NULL REFERENCES ledger(id),
  category_id    TEXT REFERENCES category(id),
  period_type    TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type = 'monthly'),
  amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency       TEXT NOT NULL CHECK (length(currency) = 3),
  effective_from TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE INDEX IF NOT EXISTS budget_by_ledger ON budget(ledger_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Append-only trail. Nothing in the application ever UPDATEs or DELETEs here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_log (
  id        TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL REFERENCES ledger(id),
  entity    TEXT NOT NULL CHECK (entity IN ('transaction','account','category','budget','rule')),
  entity_id TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('create','update','soft_delete','restore')),
  payload   TEXT NOT NULL,
  at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS event_by_entity ON event_log(entity, entity_id, at);

-- A report the user (or their own AI) saved. The spec is the whole thing:
-- re-running it later reproduces the report, and exporting it produces a Skill.
CREATE TABLE IF NOT EXISTS saved_report (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledger(id),
  name       TEXT NOT NULL,
  spec       TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS saved_report_by_ledger
  ON saved_report(ledger_id) WHERE deleted_at IS NULL;

-- Every read an outside AI makes, so the user can see what left the ledger
-- and when (FR-OPN-07). Append-only, like event_log.
CREATE TABLE IF NOT EXISTS mcp_access_log (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT NOT NULL REFERENCES ledger(id),
  client     TEXT NOT NULL,
  tool       TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('read','write')),
  summary    TEXT NOT NULL,
  row_count  INTEGER NOT NULL DEFAULT 0,
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS mcp_access_by_ledger ON mcp_access_log(ledger_id, at DESC);

-- Historical rates are cached forever and never refreshed: a March conversion
-- must still read the same a year later (FR-LED-03).
CREATE TABLE IF NOT EXISTS fx_rate_cache (
  from_currency TEXT NOT NULL CHECK (length(from_currency) = 3),
  to_currency   TEXT NOT NULL CHECK (length(to_currency) = 3),
  as_of         TEXT NOT NULL,
  rate          REAL NOT NULL CHECK (rate > 0),
  source        TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  PRIMARY KEY (from_currency, to_currency, as_of, source)
);
