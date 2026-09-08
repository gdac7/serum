CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Gateway-side mirror of a run Python owns; status is the coarse client-facing view.
CREATE TABLE IF NOT EXISTS runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    python_run_id uuid,
    target_id     uuid,
    status        text NOT NULL DEFAULT 'queued',
    model_name    text NOT NULL,
    phases        text[] NOT NULL,
    dataset       text[] NOT NULL,
    fresh_library boolean NOT NULL DEFAULT false,
    load_4_bits   boolean NOT NULL DEFAULT false,
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_user_id_idx ON runs (user_id);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS target_kind text NOT NULL DEFAULT 'local';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS endpoint_url text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS api_key_env text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS encrypted_api_key text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS standard_dataset text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS standard_dataset_percent integer;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- A target registered (and loaded on the Python service) with no attack
-- attached, unlike a run's target which only ever exists as a side effect of
-- POST /runs. Lets a user probe a model in Chat without starting a real test.
CREATE TABLE IF NOT EXISTS targets (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind              text NOT NULL DEFAULT 'local',
    model_name        text NOT NULL,
    endpoint_url      text,
    api_key_env       text,
    encrypted_api_key text,
    load_4_bits       boolean NOT NULL DEFAULT false,
    python_target_id  uuid,
    status            text NOT NULL DEFAULT 'queued',
    error             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS targets_user_id_idx ON targets (user_id);

-- CREATE IF NOT EXISTS can't alter an existing table's constraint; re-run safe.
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_user_id_fkey;
ALTER TABLE runs ADD CONSTRAINT runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE targets DROP CONSTRAINT IF EXISTS targets_user_id_fkey;
ALTER TABLE targets ADD CONSTRAINT targets_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE targets ADD COLUMN IF NOT EXISTS prompt_field text;
ALTER TABLE targets ADD COLUMN IF NOT EXISTS response_field text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS prompt_field text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS response_field text;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS connector_target_id uuid REFERENCES targets (id);

-- Credential a user's machine polls with, so a model that never accepts inbound
-- connections can still be attacked. One live connector per target; the token is
-- stored hashed because it is a bearer credential we hand out once.
CREATE TABLE IF NOT EXISTS connectors (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_id    uuid NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
    token_hash   text NOT NULL,
    last_seen_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connectors_token_hash_idx ON connectors (token_hash);
-- Rotation revokes rather than deletes, so only one unrevoked row per target.
CREATE UNIQUE INDEX IF NOT EXISTS connectors_active_target_idx
    ON connectors (target_id) WHERE revoked_at IS NULL;

-- Which red-team technique a run used; see gateway src/approaches/registry.ts.
-- Existing rows all predate any second approach, so 'autodan' is correct for
-- them. A future approach's own parameters go in a `config jsonb` column added
-- alongside; the AutoDAN columns above stay as they are.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS approach text NOT NULL DEFAULT 'autodan';
