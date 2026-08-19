// Extracts malicious requests from an uploaded dataset file (TXT or CSV) into
// the one-per-line form the dataset textarea holds.

// CSV column names that hold the request, so a multi-column file still works.
const REQUEST_KEYS = ["behavior", "goal", "prompt", "request", "query", "text", "instruction"];

function parseTxt(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
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

function parseCsv(text: string): string[] {
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
  return file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : parseTxt(text);
}
