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
    definition         TEXT,
    example_prompt_pi  TEXT,
    example_prompt_pj  TEXT,
    response_solved    TEXT,
    category           TEXT,
    mechanism          TEXT,
    key_difference     TEXT,
    success_rate       DOUBLE PRECISION NOT NULL DEFAULT 0,
    average_score      DOUBLE PRECISION NOT NULL DEFAULT 0,
    usage_count        INTEGER NOT NULL DEFAULT 0,
    improvement        DOUBLE PRECISION,
    discovered_date    TIMESTAMPTZ NOT NULL,
    source_attack_id   TEXT,
    parent_strategies  TEXT[] NOT NULL DEFAULT '{}',
    effective_against  TEXT[] NOT NULL DEFAULT '{}',
    context_embedding  vector(384),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategies_library_id_idx ON strategies (library_id);

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
    result              JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_client_id_idx ON runs (client_id);
