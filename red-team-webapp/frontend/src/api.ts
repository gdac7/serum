export interface RunInput {
  model_name: string;
  phases: string[];
  dataset: string[];
  fresh_library: boolean;
  load_4_bits: boolean;
}

export interface RunView {
  node_run_id: string;
  status: string;
  model_name: string;
  phases: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

async function request<T>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ id: string; email: string }>("/auth/register", {
      method: "POST",
      body: { email, password },
    }),

  login: (email: string, password: string) =>
    request<{ token: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  me: (token: string) =>
    request<{ user: { id: string; email: string } }>("/me", { token }),

  createRun: (token: string, body: RunInput) =>
    request<{ node_run_id: string; status: string }>("/runs", {
      method: "POST",
      token,
      body,
    }),

  getRun: (token: string, id: string) =>
    request<RunView>(`/runs/${id}`, { token }),
};
