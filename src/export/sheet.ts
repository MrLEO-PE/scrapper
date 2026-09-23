/**
 * Writes the ticked columns out in Google-Sheets-friendly shapes.
 *
 * CSV is what you import into Sheets (File > Import, or `gsheet` below for the
 * live API route). TSV pastes directly into a sheet without an import step.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../core/logger.ts";
import type { JobRow, SchoolRow } from "../store/db.ts";
import { resolveFields, type FieldContext, type FieldDef } from "./fields.ts";

export interface SheetRow {
  job?: JobRow;
  school?: SchoolRow;
}

/**
 * Escape a value for CSV. Also neutralises spreadsheet formula injection: a
 * cell starting with = + - or @ is prefixed with an apostrophe so Sheets shows
 * the text instead of evaluating it.
 */
function csvCell(value: string): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function tsvCell(value: string): string {
  let v = (value ?? "").replace(/[\t\r\n]+/g, " ");
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return v;
}

export function buildTable(rows: SheetRow[], fieldKeys: string[], scope: "job" | "school"): {
  headers: string[];
  body: string[][];
  fields: FieldDef[];
} {
  const fields = resolveFields(fieldKeys, scope);
  const headers = fields.map((f) => f.label);
  const body = rows.map((row) => {
    const ctx: FieldContext = { job: row.job, school: row.school };
    return fields.map((f) => {
      try {
        return f.get(ctx) ?? "";
      } catch {
        return "";
      }
    });
  });
  return { headers, body, fields };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // BOM so Excel and Sheets both read UTF-8 correctly.
  writeFileSync(path, "﻿" + content, "utf8");
}

export function writeCsv(path: string, rows: SheetRow[], fieldKeys: string[], scope: "job" | "school"): number {
  const { headers, body } = buildTable(rows, fieldKeys, scope);
  const lines = [headers.map(csvCell).join(","), ...body.map((r) => r.map(csvCell).join(","))];
  write(path, lines.join("\r\n"));
  log.ok(`CSV  → ${path}  (${body.length} rows × ${headers.length} cols)`);
  return body.length;
}

export function writeTsv(path: string, rows: SheetRow[], fieldKeys: string[], scope: "job" | "school"): number {
  const { headers, body } = buildTable(rows, fieldKeys, scope);
  const lines = [headers.map(tsvCell).join("\t"), ...body.map((r) => r.map(tsvCell).join("\t"))];
  write(path, lines.join("\n"));
  log.ok(`TSV  → ${path}  (paste straight into a sheet)`);
  return body.length;
}

export function writeJson(path: string, rows: SheetRow[], fieldKeys: string[], scope: "job" | "school"): number {
  const { headers, body, fields } = buildTable(rows, fieldKeys, scope);
  const objects = body.map((r) => Object.fromEntries(r.map((v, i) => [fields[i]!.key, v])));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), headers, rows: objects }, null, 2), "utf8");
  log.ok(`JSON → ${path}`);
  return objects.length;
}

export interface HtmlOptions {
  /** Links shown across the top, for a multi-page published site. */
  nav?: { label: string; href: string; current?: boolean }[];
  /** Extra line under the heading. */
  note?: string;
}

/** Standalone HTML report — sortable, with the links clickable. */
export function writeHtml(
  path: string,
  rows: SheetRow[],
  fieldKeys: string[],
  scope: "job" | "school",
  title: string,
  opts: HtmlOptions = {},
): number {
  const { headers, body, fields } = buildTable(rows, fieldKeys, scope);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const cell = (value: string, field: FieldDef): string => {
    if (!value) return "";
    if (/^https?:\/\//.test(value)) {
      const label = field.key === "job_url" ? "open" : field.key === "careers_page" ? "careers" : "link";
      return `<a href="${esc(value)}" target="_blank" rel="noopener">${label}</a>`;
    }
    if (field.key === "career_email" || field.key === "school_email") {
      return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
    }
    return esc(value);
  };

  const statusIndex = fields.findIndex((f) => f.key === "status");
  const seniorityIndex = fields.findIndex((f) => f.key === "seniority");
  /** Leadership roles are the point of the search, so they are marked. */
  const LEADERSHIP = new Set(["Director of Sport", "Head of Department", "2nd in Department"]);

  const rowClass = (r: string[]) => {
    const classes: string[] = [];
    if (statusIndex >= 0) {
      const s = r[statusIndex];
      if (s === "Closed") classes.push("closed");
      else if (s === "Possibly filled") classes.push("stale");
    }
    if (seniorityIndex >= 0 && LEADERSHIP.has(r[seniorityIndex] ?? "")) classes.push("lead");
    return classes.length ? ` class="${classes.join(" ")}"` : "";
  };

  const leadershipCount = body.filter((r) =>
    seniorityIndex >= 0 ? LEADERSHIP.has(r[seniorityIndex] ?? "") : false,
  ).length;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --line:#d5dae1; --head:#f3f5f8; --muted:#6b7480; --bg:#fff; --fg:#14181d; }
  @media (prefers-color-scheme: dark) {
    :root { --line:#333a44; --head:#1b2027; --muted:#98a2b0; --bg:#0f1319; --fg:#e6eaf0; }
  }
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: var(--bg); color: var(--fg); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.meta { color: var(--muted); margin: 0 0 18px; }
  input { padding: 8px 10px; width: min(340px, 100%); margin-bottom: 14px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--fg); }
  .wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 9px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; max-width: 380px; }
  th { background: var(--head); position: sticky; top: 0; cursor: pointer; white-space: nowrap; }
  th:hover { text-decoration: underline; }
  tr.closed { opacity: .45; }
  tr.stale { background: color-mix(in srgb, orange 9%, transparent); }
  tr.lead { background: color-mix(in srgb, dodgerblue 10%, transparent); }
  tr.lead td:first-child { box-shadow: inset 3px 0 0 dodgerblue; }
  tr.lead.stale { background: color-mix(in srgb, orange 12%, transparent); }
  label.only { margin-left: 14px; font-size: 13px; color: var(--muted); cursor: pointer; user-select: none; }
  a { color: inherit; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
  nav a { padding: 6px 13px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; font-size: 13px; }
  nav a.current { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  nav a:hover { border-color: var(--fg); }
  @media (max-width: 640px) { body { padding: 16px; } th, td { max-width: 220px; } }
</style></head><body>
${
  opts.nav?.length
    ? `<nav>${opts.nav
        .map((n) => `<a href="${esc(n.href)}"${n.current ? ' class="current"' : ""}>${esc(n.label)}</a>`)
        .join("")}</nav>`
    : ""
}
<h1>${esc(title)}</h1>
<p class="meta">${body.length} rows${leadershipCount ? ` · ${leadershipCount} leadership` : ""} · updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · click a header to sort${opts.note ? ` · ${esc(opts.note)}` : ""}</p>
<input id="q" placeholder="Filter rows…" autocomplete="off">
${leadershipCount ? '<label class="only"><input type="checkbox" id="leadOnly"> leadership roles only</label>' : ""}
<div class="wrap"><table>
<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>
${body.map((r) => `<tr${rowClass(r)}>${r.map((v, i) => `<td>${cell(v, fields[i]!)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>
<script>
const rows = [...document.querySelectorAll("tbody tr")];
const q = document.getElementById("q");
const leadOnly = document.getElementById("leadOnly");

function applyFilters() {
  const needle = q.value.toLowerCase();
  const onlyLead = leadOnly && leadOnly.checked;
  for (const r of rows) {
    const matchesText = r.textContent.toLowerCase().includes(needle);
    const matchesLead = !onlyLead || r.classList.contains("lead");
    r.style.display = matchesText && matchesLead ? "" : "none";
  }
}
q.addEventListener("input", applyFilters);
if (leadOnly) leadOnly.addEventListener("change", applyFilters);
document.querySelectorAll("th").forEach((th, i) => {
  let asc = true;
  th.addEventListener("click", () => {
    const tbody = document.querySelector("tbody");
    const sorted = [...tbody.querySelectorAll("tr")].sort((a, b) => {
      const x = a.children[i].textContent.trim(), y = b.children[i].textContent.trim();
      const nx = parseFloat(x), ny = parseFloat(y);
      if (!isNaN(nx) && !isNaN(ny)) return asc ? nx - ny : ny - nx;
      return asc ? x.localeCompare(y) : y.localeCompare(x);
    });
    asc = !asc;
    sorted.forEach(r => tbody.appendChild(r));
  });
});
</script>
</body></html>`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html, "utf8");
  log.ok(`HTML → ${path}  (open in a browser to review)`);
  return body.length;
}
