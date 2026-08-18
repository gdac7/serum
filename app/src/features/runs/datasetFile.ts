// Extracts malicious requests from an uploaded dataset file (JSON or CSV) into
// the one-per-line form the dataset textarea holds.

const REQUEST_KEYS = [
  "behavior", "goal", "prompt", "request", "query",
  "text", "instruction", "question", "input",
];

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// Prefer a recognized request column; otherwise the first non-empty string.
function pickField(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (REQUEST_KEYS.includes(key.toLowerCase())) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function collect(rows: unknown[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      if (row.trim()) out.push(row.trim());
    } else if (isRecord(row)) {
      const v = pickField(row);
      if (v) out.push(v);
    }
  }
  return out;
}

function parseJsonDataset(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // JSONL: one JSON value per line.
    const items = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    return collect(items);
  }
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : null;
  if (!rows) throw new Error("expected a JSON array of requests (or a { data: [...] } wrapper)");
  return collect(rows);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function parseCsvDataset(text: string): string[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const known = header.findIndex((cell) => REQUEST_KEYS.includes(cell));
  const col = known >= 0 ? known : 0;
  const start = known >= 0 ? 1 : 0;
  const out: string[] = [];
  for (let i = start; i < rows.length; i++) {
    const cell = (rows[i][col] ?? "").trim();
    if (cell) out.push(cell);
  }
  return out;
}

export async function parseDatasetFile(file: File): Promise<string[]> {
  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || name.endsWith(".jsonl")) return parseJsonDataset(text);
  if (name.endsWith(".csv")) return parseCsvDataset(text);
  const trimmed = text.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{")
    ? parseJsonDataset(text)
    : parseCsvDataset(text);
}
