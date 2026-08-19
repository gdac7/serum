export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FieldIssue {
  path?: string;
  message?: string;
}

async function parseErrorBody(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    const base = json.error ?? json.message ?? text;
    // Validation failures carry the field and reason in `details`; without them
    // the top-level "validation failed" says nothing the user can act on.
    if (Array.isArray(json.details) && json.details.length > 0) {
      const issues = (json.details as FieldIssue[])
        .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
        .filter(Boolean)
        .join("; ");
      return issues ? `${base} — ${issues}` : base;
    }
    return base;
  } catch {
    return text || res.statusText;
  }
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorBody(res));
  }
  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    // A 2xx response that isn't JSON usually means this path isn't actually
    // reaching the gateway (e.g. an unproxied route falling through to the
    // dev server's own index.html) — a distinct, debuggable failure from a
    // dropped connection, which is what a bare thrown error would suggest.
    throw new ApiError(res.status, `unexpected response from ${path} — is it proxied to the gateway?`);
  }
}
