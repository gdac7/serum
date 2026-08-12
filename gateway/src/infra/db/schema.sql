CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Gateway-side mirror of a run Python owns; status is the coarse client-facing view.
CREATE TABLE IF NOT EXISTS runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id),
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
