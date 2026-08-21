CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS strategy_libraries (
    library_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   TEXT NOT NULL,
    target_key  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, target_key)
);

CREATE TABLE IF NOT EXISTS strategies (
    strategy_id        UUID PRIMARY KEY,
    library_id         UUID NOT NULL REFERENCES strategy_libraries (library_id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    malicious_request  TEXT,
    definition         TEXT,
    example_prompt_pi  TEXT,
    example_prompt_pj  TEXT,
    response_i         TEXT,
    response_j         TEXT,
    category           TEXT,
    mechanism          TEXT,
    key_difference     TEXT,
    success_rate       DOUBLE PRECISION NOT NULL DEFAULT 0,
    average_score      DOUBLE PRECISION NOT NULL DEFAULT 0,
    usage_count        INTEGER NOT NULL DEFAULT 0,
    improvement        DOUBLE PRECISION,
    score_i            DOUBLE PRECISION,
    score_j            DOUBLE PRECISION,
    discovered_date    TIMESTAMPTZ NOT NULL,
    source_attack_id   TEXT,
    parent_strategies  TEXT[] NOT NULL DEFAULT '{}',
    effective_against  TEXT[] NOT NULL DEFAULT '{}',
    context_embedding  vector(384),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategies_library_id_idx ON strategies (library_id);

-- Backfill columns on libraries created before they existed.
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS malicious_request TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS response_j TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS score_i DOUBLE PRECISION;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS score_j DOUBLE PRECISION;

-- response_solved -> response_i, dropped in favor of the pi/pj-symmetric name.
-- Guarded: a plain RENAME COLUMN would fail on re-apply once already renamed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'strategies' AND column_name = 'response_solved'
    ) THEN
        ALTER TABLE strategies RENAME COLUMN response_solved TO response_i;
    END IF;
END $$;

-- GPU weights can't persist a restart, but the config that rebuilds them can.
-- target_id is the deterministic uuid5 from target_key.py.
CREATE TABLE IF NOT EXISTS targets (
    target_id     UUID PRIMARY KEY,
    client_id     TEXT NOT NULL,
    target_key    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    model_name    TEXT NOT NULL,
    endpoint_url  TEXT,
    api_key_env   TEXT,
    load_4_bits   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, target_key)
);

CREATE INDEX IF NOT EXISTS targets_client_id_idx ON targets (client_id);

CREATE TABLE IF NOT EXISTS runs (
    run_id              UUID PRIMARY KEY,
    client_id           TEXT NOT NULL,
    -- Config-derived handle, not an FK: a run outlives the in-memory target.
    target_id           UUID NOT NULL,
    library_id          UUID REFERENCES strategy_libraries (library_id) ON DELETE SET NULL,
    status              TEXT NOT NULL,
    phases              TEXT[] NOT NULL DEFAULT '{}',
    error               TEXT,
    persist_errors      TEXT[] NOT NULL DEFAULT '{}',
    strategies_at_start INTEGER,
    strategies_loaded   INTEGER,
    request_scores      JSONB NOT NULL DEFAULT '[]'::jsonb,
    result              JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_client_id_idx ON runs (client_id);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS request_scores JSONB NOT NULL DEFAULT '[]'::jsonb;
