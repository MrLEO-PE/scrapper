/**
 * The record of who has already been emailed.
 *
 * Deliberately not a column on `schools`: that table is rewritten by every
 * scrape and enrich run, and the scheduled Action already produces merge
 * conflicts on it (see the project's own history). A sent record that a scrape
 * can silently clobber is not a record — it is how a school already written to
 * gets written to again. So this lives in its own append-only file, touched by
 * nothing else, and is tracked in git like `data/jobs.db` is, via the same
 * gitignore exception.
 *
 * Append-only by design: the question this file answers is "did I ever write
 * to this address", not "what is the latest state of it", so there is nothing
 * to update in place and no way to lose a line by mistake.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SentRecord {
  /** The recipient address actually written to — the dedupe key. */
  email: string;
  /** ISO date (YYYY-MM-DD) the batch was sent. */
  date: string;
  /** Every school this address covers, for the record. */
  schools: string[];
}

export const SENT_LOG_PATH = process.env.SCRAPPER_SENT_LOG || join(process.cwd(), "data", "sent-log.jsonl");

/**
 * Every address ever recorded, most recent send per address.
 *
 * A re-send after a long enough gap is a legitimate thing to do — hiring runs
 * on an annual cycle — so callers get the date back rather than a bare
 * yes/no, and decide their own cutoff.
 */
export function loadSentLog(path: string = SENT_LOG_PATH): Map<string, SentRecord> {
  const byEmail = new Map<string, SentRecord>();
  if (!existsSync(path)) return byEmail;

  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as SentRecord;
      if (!rec.email || !rec.date) continue;
      const email = rec.email.toLowerCase();
      const prev = byEmail.get(email);
      // Keep the latest send per address; a line is never edited or removed,
      // so the newest one read last naturally wins when dates tie.
      if (!prev || rec.date >= prev.date) byEmail.set(email, { ...rec, email });
    } catch {
      // A malformed line should not take the whole log down.
    }
  }
  return byEmail;
}

/** Append one line per address sent today. Never rewrites what is already there. */
export function recordSent(records: { email: string; schools: string[] }[], path: string = SENT_LOG_PATH): void {
  if (!records.length) return;
  mkdirSync(dirname(path), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const lines = records.map((r) => JSON.stringify({ email: r.email.toLowerCase(), date, schools: r.schools }));
  appendFileSync(path, lines.join("\n") + "\n", "utf8");
}

/** Months since an address was last written to, or null if never. */
export function monthsSinceSent(rec: SentRecord | undefined): number | null {
  if (!rec) return null;
  const then = Date.parse(rec.date);
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (30.44 * 86_400_000);
}
