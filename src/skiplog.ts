/**
 * The record of addresses you decided not to write to.
 *
 * The same shape and the same reasoning as the sent log (see sentlog.ts): its
 * own append-only file that no scrape touches, so a decision is not undone by
 * the next run. An address can be skipped once and applied to later; the page
 * shows whichever happened last.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SkipRecord {
  email: string;
  /** ISO date (YYYY-MM-DD) it was marked not interested. */
  date: string;
  schools: string[];
}

export const SKIP_LOG_PATH = process.env.SCRAPPER_SKIP_LOG || join(process.cwd(), "data", "skip-log.jsonl");

/** Every skipped address, latest decision per address. */
export function loadSkipLog(path: string = SKIP_LOG_PATH): Map<string, SkipRecord> {
  const byEmail = new Map<string, SkipRecord>();
  if (!existsSync(path)) return byEmail;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as SkipRecord;
      if (!rec.email || !rec.date) continue;
      const email = rec.email.toLowerCase();
      const prev = byEmail.get(email);
      if (!prev || rec.date >= prev.date) byEmail.set(email, { ...rec, email, schools: rec.schools ?? [] });
    } catch {
      // A malformed line must not take the whole log down.
    }
  }
  return byEmail;
}

/** Append one line per address. Never rewrites what is already there. */
export function recordSkipped(
  records: { email: string; schools: string[]; date?: string }[],
  path: string = SKIP_LOG_PATH,
): void {
  if (!records.length) return;
  mkdirSync(dirname(path), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const lines = records.map((r) => JSON.stringify({ email: r.email.toLowerCase(), date: r.date ?? today, schools: r.schools }));
  appendFileSync(path, lines.join("\n") + "\n", "utf8");
}
