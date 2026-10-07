/**
 * The permanent record of the job search: which roles were applied for or
 * ruled out, at which school, for which position, and when.
 *
 * Why a file of its own. The marks on the site live in one browser, and
 * `jobs.db` is rewritten by every scheduled scrape — the project already
 * merges it by hand after each run. Neither is a place to keep a year of
 * applications. This file is touched by nothing else, is append-only, and is
 * tracked in git like the database, so it survives a cleared browser, a new
 * laptop and a bad merge.
 *
 * It is keyed on `dedupe_key` (school + position title) as well as the job id.
 * A school that re-posts the same role gets a new id, but not a new key — so a
 * second advert for a position you already applied for is still recognised.
 *
 * Append-only: "undo" is a later event, never a deleted line, so the history
 * of what was decided and when stays intact.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LedgerEvent = "applied" | "unapplied" | "skipped" | "unskipped";

export interface LedgerEntry {
  at: string;
  event: LedgerEvent;
  job_id: string;
  dedupe_key: string;
  school_key: string | null;
  school: string | null;
  title: string;
  url?: string | null;
}

export const LEDGER_PATH = process.env.SCRAPPER_LEDGER || join(process.cwd(), "data", "applications.jsonl");

export function appendLedger(entries: LedgerEntry[], path: string = LEDGER_PATH): void {
  if (!entries.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

export function readLedger(path: string = LEDGER_PATH): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      if (e.at && e.event && e.dedupe_key) out.push(e);
    } catch {
      // One bad line must not take the whole history down.
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export interface LedgerState {
  /** Current state per position: the latest applied/unapplied event wins. */
  applied: Map<string, LedgerEntry>;
  skipped: Map<string, LedgerEntry>;
  /** Every application ever made, per school, oldest first. */
  bySchool: Map<string, LedgerEntry[]>;
}

export function ledgerState(entries: LedgerEntry[] = readLedger()): LedgerState {
  const applied = new Map<string, LedgerEntry>();
  const skipped = new Map<string, LedgerEntry>();
  const bySchool = new Map<string, LedgerEntry[]>();

  for (const e of entries) {
    if (e.event === "applied") {
      applied.set(e.dedupe_key, e);
      skipped.delete(e.dedupe_key);
      if (e.school_key) bySchool.set(e.school_key, [...(bySchool.get(e.school_key) ?? []), e]);
    } else if (e.event === "unapplied") {
      applied.delete(e.dedupe_key);
    } else if (e.event === "skipped") {
      if (!applied.has(e.dedupe_key)) skipped.set(e.dedupe_key, e);
    } else if (e.event === "unskipped") {
      skipped.delete(e.dedupe_key);
    }
  }
  return { applied, skipped, bySchool };
}

const niceDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * What the sheet says about a school's history: every position applied for
 * there, and — when the role in this row is one of them — a loud marker that
 * it is the same position.
 */
export function historyFor(
  state: LedgerState,
  schoolKey: string | null | undefined,
  dedupeKey?: string | null,
): string {
  if (!schoolKey) return "";
  const past = (state.bySchool.get(schoolKey) ?? []).filter((e) => state.applied.has(e.dedupe_key));
  if (!past.length) return "";
  const lines = past.map((e) => `${niceDate(e.at)}: ${e.title}`);
  const same = dedupeKey && state.applied.has(dedupeKey) ? "SAME ROLE — " : "";
  return `${same}applied ${past.length}× — ${lines.join("; ")}`;
}
