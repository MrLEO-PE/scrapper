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
import { daysUntil, resolveFields, type FieldContext, type FieldDef } from "./fields.ts";

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

  /*
   * A failing getter must not take the whole export down — but it must not
   * pass for "no data" either. Swallowing it silently once produced a column
   * that read empty for all 521 schools because of a mistyped column name,
   * and an empty cell is exactly what a genuinely unknown value looks like.
   * So: keep going, then say what broke and how often.
   */
  const failures = new Map<string, { count: number; message: string }>();
  const body = rows.map((row) => {
    const ctx: FieldContext = { job: row.job, school: row.school };
    return fields.map((f) => {
      try {
        return f.get(ctx) ?? "";
      } catch (err) {
        const prev = failures.get(f.key);
        failures.set(f.key, {
          count: (prev?.count ?? 0) + 1,
          message: prev?.message ?? (err as Error).message,
        });
        return "";
      }
    });
  });

  for (const [key, { count, message }] of failures) {
    log.warn(`column "${key}" failed on ${count} of ${rows.length} rows and is blank there: ${message}`);
  }

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
  nav?: { label: string; href: string; current?: boolean; cta?: boolean }[];
  /** Extra line under the heading. */
  note?: string;
  /**
   * Which half of the applied split this page shows.
   *
   * "applied" lists only the roles you have marked, and every other page
   * hides them. The two pages are built from the same rows and sort
   * themselves in the browser, because which roles you have applied for is
   * known only there — the mark is kept in local storage, and a static page
   * has nowhere else to put it.
   */
  view?: "default" | "applied";
}

/**
 * The site's stylesheet, shared by every page it publishes.
 *
 * Extracted so a page that is not a table — the one listing what has to be
 * done by hand — sits in the same shell as the rest rather than a lookalike
 * that drifts from it at the next change.
 */
const PAGE_CSS = `  :root { color-scheme: light dark; --line:#d5dae1; --head:#f3f5f8; --muted:#6b7480; --bg:#fff; --fg:#14181d; }
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
  /* The count is in the cell, so it is coloured rather than badged — a badge
     beside a number that already says "3 days" only repeated it. */
  tr.urgent td.col-days-left { color: #d1242f; font-weight: 700; white-space: nowrap; }
  tr.closed td.col-days-left { font-weight: 400; }

  /* A role you have already applied for should be recognisable without
     reading it, and should stop competing for attention with the live ones. */
  tr.applied { background: color-mix(in srgb, #1f883d 13%, transparent); }
  tr.applied td:first-child { box-shadow: inset 3px 0 0 #1f883d; }
  tr.applied.lead { background: color-mix(in srgb, #1f883d 16%, transparent); }
  td.col-applied { white-space: nowrap; }
  button.mark { font: inherit; font-size: 12px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); cursor: pointer; }
  button.mark:hover { border-color: #1f883d; color: #1f883d; }
  button.mark.done { border-color: #1f883d; background: color-mix(in srgb, #1f883d 18%, transparent); color: inherit; font-weight: 600; }

  /* A form to fill in is work to do before applying — an afternoon, not a
     click — so the whole row is tinted rather than marked at one edge. The
     underline stays as well: the tint is easy to miss once several row
     colours are in play, and this is the one that costs you time. */
  tr.hasform { background: color-mix(in srgb, #d29922 16%, transparent); }
  tr.hasform td { box-shadow: inset 0 -2px 0 #d29922; }
  tr.hasform.lead { background: color-mix(in srgb, #d29922 22%, transparent); }
  tr.hasform.applied { background: color-mix(in srgb, #d29922 12%, transparent); }

  p.empty { color: var(--muted); padding: 18px 2px; margin: 0; }
  tr.fresh td:first-child::before { content: "new"; margin-right: 6px; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #1f883d; color: #fff; vertical-align: middle; }
  label.only { margin-left: 14px; font-size: 13px; color: var(--muted); cursor: pointer; user-select: none; }
  a { color: inherit; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
  nav a { padding: 6px 13px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; font-size: 13px; }
  nav a.current { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  nav a:hover { border-color: var(--fg); }
  nav a.cta { margin-left: auto; background: #1f883d; color: #fff; border-color: #1f883d; font-weight: 600; }
  nav a.cta:hover { background: #1a7f37; }
  @media (max-width: 640px) { body { padding: 16px; } th, td { max-width: 220px; } }
`;

/** The nav strip across the top of every page. */
function navStrip(nav: HtmlOptions["nav"], esc: (s: string) => string): string {
  if (!nav?.length) return "";
  return `<nav>${nav
    .map((n) => `<a href="${esc(n.href)}"${n.cta ? ' class="cta" target="_blank" rel="noopener"' : n.current ? ' class="current"' : ""}>${esc(n.label)}</a>`)
    .join("")}</nav>`;
}

/**
 * A page of prose and lists rather than a table.
 *
 * Shares the stylesheet, the nav and the tick-persistence of the table pages,
 * so it reads as part of the site and not a document that wandered in.
 */
export function writePage(
  path: string,
  title: string,
  body: string,
  opts: HtmlOptions = {},
): void {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${PAGE_CSS}
  h2.nr-h { font-size: 17px; margin: 34px 0 6px; }
  p.nr-lead { color: var(--muted); max-width: 72ch; margin: 0 0 14px; }
  h3.nr-c { font-size: 14px; margin: 22px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .nr-n { font-weight: 400; opacity: .7; }
  ul.nr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li.nr-item {
    display: grid; grid-template-columns: auto 1fr auto; gap: 4px 11px; align-items: start;
    border: 1px solid var(--line); border-radius: 7px; padding: 10px 12px;
  }
  li.nr-item.scraped { border-left: 3px solid #1f883d; }
  li.nr-item.ticked { opacity: .5; }
  li.nr-item.ticked .nr-name { text-decoration: line-through; }
  .nr-name { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
  .nr-meta { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .nr-note { margin: 5px 0 0; font-size: 12.5px; color: var(--muted); max-width: 72ch; }
  .nr-rank { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; margin-right: 4px; }
  .nr-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; background: color-mix(in srgb, #1f883d 18%, transparent); color: #1f883d; padding: 2px 6px; border-radius: 4px; }
  .nr-links { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
  .nr-btn { font-size: 12px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: inherit; white-space: nowrap; }
  a.nr-btn:hover { border-color: var(--fg); }
  a.nr-btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); font-weight: 600; }
  .nr-btn.kind, .nr-btn.warn { color: var(--muted); }
  .nr-btn.warn { border-style: dashed; }
  .tick { cursor: pointer; padding-top: 2px; }
  .tick input { position: absolute; opacity: 0; width: 0; height: 0; }
  .tick .box { width: 16px; height: 16px; border: 1.5px solid var(--muted); border-radius: 4px; display: block; }
  .tick input:checked + .box { background: #1f883d; border-color: #1f883d; }
  .tick input:checked + .box::after { content: "✓"; color: #fff; font-size: 11px; line-height: 14px; display: block; text-align: center; }
  .tick input:focus-visible + .box { outline: 2px solid #1f883d; outline-offset: 2px; }
  @media (max-width: 620px) {
    li.nr-item { grid-template-columns: auto 1fr; }
    .nr-links { grid-column: 1 / -1; justify-content: flex-start; margin-top: 6px; }
  }
</style></head><body>
${navStrip(opts.nav, esc)}
<h1>${esc(title)}</h1>
${body}
<script>
  var KEY = "norobot-ticked";
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  var ticked = read();
  Array.prototype.forEach.call(document.querySelectorAll("input[data-mark]"), function (box) {
    var id = box.dataset.mark;
    var item = box.closest("li");
    box.checked = !!ticked[id];
    item.classList.toggle("ticked", box.checked);
    box.addEventListener("change", function () {
      if (box.checked) ticked[id] = 1; else delete ticked[id];
      try { localStorage.setItem(KEY, JSON.stringify(ticked)); } catch (e) { /* private window */ }
      item.classList.toggle("ticked", box.checked);
    });
  });
</script>
</body></html>`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html, "utf8");
  log.ok(`HTML → ${path}`);
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
      const label =
        field.key === "job_url" ? "open"
        : field.key === "careers_page" ? "careers"
        : field.key === "form_link" ? "form"
        : "link";
      return `<a href="${esc(value)}" target="_blank" rel="noopener">${label}</a>`;
    }
    if (field.key === "career_email" || field.key === "school_email") {
      return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
    }
    return esc(value);
  };

  const statusIndex = fields.findIndex((f) => f.key === "status");
  const seniorityIndex = fields.findIndex((f) => f.key === "seniority");
  const formIndex = fields.findIndex((f) => f.key === "application_form");
  /** Leadership roles are the point of the search, so they are marked. */
  const LEADERSHIP = new Set(["Director of Sport", "Head of Department", "2nd in Department"]);

  // Urgency is read from the row data rather than the rendered cells, so it
  // stays correct no matter which columns are ticked.
  const isFresh = (row: SheetRow): boolean => {
    const seen = row.job?.first_seen_at ? Date.parse(row.job.first_seen_at) : NaN;
    return !Number.isNaN(seen) && Date.now() - seen < 2 * 86_400_000;
  };

  /**
   * On a newly built database every row is "new", and a badge on every row
   * conveys nothing. Show it only while it still discriminates.
   */
  const freshCount = rows.filter(isFresh).length;
  const markFresh = rows.length > 0 && freshCount / rows.length < 0.4;

  const rowAttrs = (r: string[], row: SheetRow) => {
    const classes: string[] = [];
    if (statusIndex >= 0) {
      const s = r[statusIndex];
      if (s === "Closed") classes.push("closed");
      else if (s === "Possibly filled") classes.push("stale");
    }
    if (seniorityIndex >= 0 && LEADERSHIP.has(r[seniorityIndex] ?? "")) classes.push("lead");

    const left = daysUntil(row.job?.deadline_at);
    const urgent = left !== null && left >= 0 && left <= 7;
    if (urgent) classes.push("urgent");

    if (markFresh && isFresh(row)) classes.push("fresh");

    // A form to fill in is work to do before you can apply, so it is marked
    // on the row rather than left in a column you have to scroll to.
    if (formIndex >= 0 && r[formIndex]?.startsWith("Yes")) classes.push("hasform");

    /*
     * The job id travels with the row so the page can remember, in this
     * browser, which roles you have marked as applied for. It is the advert's
     * own id, so the mark survives a rebuild: the row is rewritten every run,
     * but it keeps the same identity.
     */
    const id = row.job?.id ? ` data-job="${esc(row.job.id)}"` : "";
    if (!classes.length) return id;
    return ` class="${classes.join(" ")}"${id}`;
  };

  const leadershipCount = body.filter((r) =>
    seniorityIndex >= 0 ? LEADERSHIP.has(r[seniorityIndex] ?? "") : false,
  ).length;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${PAGE_CSS}</style></head><body>
${
  opts.nav?.length
    ? `<nav>${opts.nav
        .map((n) => `<a href="${esc(n.href)}"${n.cta ? ' class="cta" target="_blank" rel="noopener"' : n.current ? ' class="current"' : ""}>${esc(n.label)}</a>`)
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
${body.map((r, i) => `<tr${rowAttrs(r, rows[i]!)}>${r.map((v, j) => `<td class="col-${esc(fields[j]!.key.replace(/_/g, "-"))}">${cell(v, fields[j]!)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>
<p class="empty" id="empty" style="display:none">${esc(opts.view === "applied" ? "Nothing here yet. Mark a role as applied on the Open roles page and it moves to this tab." : "No rows match.")}</p>
<script>
const VIEW = "${opts.view ?? "default"}";
const rows = [...document.querySelectorAll("tbody tr")];
const q = document.getElementById("q");
const leadOnly = document.getElementById("leadOnly");

/*
 * Marking a role as applied for.
 *
 * This page is a static file on GitHub Pages — there is nothing to post to —
 * so the date is kept in this browser. That has a real limit worth knowing:
 * it does not reach the database, another device or another browser, and
 * clearing site data clears it. "npm run track" is the permanent record, and
 * anything already marked there arrives with the tick already in the cell.
 */
const STORE = "applied-dates";
const readMarks = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
const writeMarks = (m) => { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private window */ } };
const niceDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const marks = readMarks();

/**
 * A role counts as applied for if the database already says so — set by
 * "npm run track", and rendered into the cell before the page was sent — or
 * if it has been marked in this browser.
 */
function isApplied(row) {
  return row.dataset.appliedDb === "1" || !!marks[row.dataset.job];
}

function setupApplied() {
  const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  const col = headers.indexOf("Applied");
  if (col < 0) return;

  for (const row of rows) {
    const id = row.dataset.job;
    const td = row.children[col];
    if (!id || !td) continue;

    // A tick already in the cell is the database's, and the stronger record:
    // it was typed deliberately and survives a cleared browser. Left alone.
    if (td.textContent.trim()) { row.dataset.appliedDb = "1"; continue; }

    const button = document.createElement("button");
    button.className = "mark";
    const paint = () => {
      const on = marks[id];
      button.textContent = on ? "✅ " + niceDate(on) : "mark applied";
      button.classList.toggle("done", !!on);
      button.title = on ? "Applied on " + niceDate(on) + " — click to undo" : "Record that you applied today";
      row.classList.toggle("applied", !!on);
    };
    button.addEventListener("click", () => {
      if (marks[id]) delete marks[id];
      else marks[id] = new Date().toISOString();
      writeMarks(marks);
      paint();
      // The row now belongs to the other page, so take it off this one.
      applyFilters();
    });
    td.textContent = "";
    td.appendChild(button);
    paint();
  }
}
setupApplied();
// The split is decided in the browser, so the first pass happens here
// rather than in the markup that was written before the marks existed.
applyFilters();

function applyFilters() {
  const needle = q.value.toLowerCase();
  const onlyLead = leadOnly && leadOnly.checked;
  let shown = 0;
  for (const r of rows) {
    const matchesText = r.textContent.toLowerCase().includes(needle);
    const matchesLead = !onlyLead || r.classList.contains("lead");
    // The applied split. Both pages are built from the same rows and decide
    // here which half they are showing, because the mark lives in this
    // browser and the page was written before it existed.
    const applied = isApplied(r);
    const matchesView = VIEW === "applied" ? applied : !applied;
    const show = matchesText && matchesLead && matchesView;
    r.style.display = show ? "" : "none";
    if (show) shown++;
  }
  const empty = document.getElementById("empty");
  if (empty) empty.style.display = shown ? "none" : "";
}
q.addEventListener("input", applyFilters);
if (leadOnly) leadOnly.addEventListener("change", applyFilters);
document.querySelectorAll("th").forEach((th, i) => {
  let asc = true;
  th.addEventListener("click", () => {
    const tbody = document.querySelector("tbody");
    // "today" and "tomorrow" are counts written as words, and sorting them
    // alphabetically would file the two most urgent rows under T.
    const WORDS = { closed: -1, today: 0, tomorrow: 1 };
    const num = (s) => (s.toLowerCase() in WORDS ? WORDS[s.toLowerCase()] : parseFloat(s));
    const sorted = [...tbody.querySelectorAll("tr")].sort((a, b) => {
      const x = a.children[i].textContent.trim(), y = b.children[i].textContent.trim();
      // A blank sorts last either way: no deadline is not "very urgent".
      if (!x !== !y) return !x ? 1 : -1;
      const nx = num(x), ny = num(y);
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
