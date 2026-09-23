/**
 * Your pipeline: which roles you have applied to, and where each one stands.
 *
 * This is the one part of the database you own. A scrape never writes these
 * columns and never clears them, so marking something "applied" survives every
 * future run — including the ones that close the vacancy.
 *
 * Roles are picked by typing part of the title or school rather than an id,
 * because ids are unreadable and you already know which job you mean.
 */

import { getDb, type JobRow } from "./store/db.ts";
import { slugify } from "./core/text.ts";

export const STATUSES = [
  "interested",
  "applied",
  "interview",
  "offer",
  "rejected",
  "skip",
] as const;

export type MyStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  interested: "Interested",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  skip: "Not for me",
};

/** Statuses meaning "I have dealt with this" — used to quieten reminders. */
export const SETTLED = new Set(["applied", "interview", "offer", "rejected", "skip"]);

export function isStatus(value: string): value is MyStatus {
  return (STATUSES as readonly string[]).includes(value);
}

export interface Match {
  job: JobRow;
  score: number;
}

/**
 * Find the roles matching a typed phrase.
 *
 * Every word must appear somewhere in the title, school, city or country, so
 * "kdu head" finds the Sri KDU Head of Sports without matching every other
 * head of department.
 */
export function findJobs(query: string, includeClosed = false): Match[] {
  const words = slugify(query).split("-").filter(Boolean);
  if (!words.length) return [];

  const rows = getDb()
    .prepare(
      `SELECT * FROM jobs
        WHERE is_pe = 1 ${includeClosed ? "" : "AND status != 'closed'"}
        ORDER BY pe_score DESC`,
    )
    .all() as unknown as JobRow[];

  const matches: Match[] = [];
  for (const job of rows) {
    const hay = slugify(
      [job.title, job.school_name, job.city, job.country, job.my_status].filter(Boolean).join(" "),
    );
    if (!words.every((w) => hay.includes(w))) continue;
    // A match in the title is what you usually mean.
    const inTitle = words.filter((w) => slugify(job.title).includes(w)).length;
    matches.push({ job, score: inTitle * 10 + job.pe_score });
  }
  return matches.sort((a, b) => b.score - a.score);
}

export function setStatus(jobId: string, status: MyStatus, note?: string): void {
  getDb()
    .prepare(
      `UPDATE jobs
          SET my_status = ?, my_status_at = ?, my_note = COALESCE(?, my_note)
        WHERE id = ?`,
    )
    .run(status, new Date().toISOString(), note ?? null, jobId);
}

export function clearStatus(jobId: string): void {
  getDb()
    .prepare("UPDATE jobs SET my_status = NULL, my_status_at = NULL, my_note = NULL WHERE id = ?")
    .run(jobId);
}

export interface PipelineEntry {
  job: JobRow;
  daysLeft: number | null;
}

/** Everything you have marked, newest decision first. */
export function pipeline(): PipelineEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM jobs WHERE my_status IS NOT NULL ORDER BY my_status_at DESC")
    .all() as unknown as JobRow[];
  return rows.map((job) => ({ job, daysLeft: daysUntil(job.deadline_at) }));
}

/**
 * Roles closing soon that you have not dealt with.
 *
 * This is the question the sheet could not answer before: not "what is new"
 * but "what will I lose if I do nothing today".
 */
export function needsAttention(withinDays = 7): PipelineEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM jobs
        WHERE is_pe = 1 AND status = 'open'
          AND deadline_at IS NOT NULL
          AND (my_status IS NULL OR my_status = 'interested')
        ORDER BY deadline_at ASC`,
    )
    .all() as unknown as JobRow[];

  return rows
    .map((job) => ({ job, daysLeft: daysUntil(job.deadline_at) }))
    .filter((e) => e.daysLeft !== null && e.daysLeft >= 0 && e.daysLeft <= withinDays);
}

export function counts(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT my_status s, COUNT(*) c FROM jobs WHERE my_status IS NOT NULL GROUP BY s")
    .all() as unknown as { s: string; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.s, Number(r.c)]));
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}
