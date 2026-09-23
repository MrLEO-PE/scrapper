/**
 * What is worth interrupting you for.
 *
 * A published page only helps if you remember to look at it, and a Head of
 * Sport can appear and close inside a week. This picks out the handful of
 * vacancies that genuinely warrant a look now, and the caller turns them into
 * a notification.
 *
 * Each alerted vacancy is stamped, so a daily run reports a role once rather
 * than every morning until it closes. A deadline that moves into the warning
 * window still triggers, because that is new information.
 */

import { getDb, parseJsonColumn, type JobRow } from "./store/db.ts";
import type { Salary } from "./core/types.ts";

/** A deadline this close is worth flagging. */
export const CLOSING_SOON_DAYS = 7;

export type AlertReason = "leadership" | "closing" | "strong";

export interface Alert {
  job: JobRow;
  reasons: AlertReason[];
  daysLeft: number | null;
}

const LEADERSHIP = new Set(["director_of_sport", "head_of_department", "second_in_department"]);

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export interface FindOptions {
  /** Report roles already alerted about. Useful for a manual digest. */
  includeAlerted?: boolean;
  /** Minimum PE score for the "strong match" reason. */
  strongScore?: number;
}

/**
 * Vacancies worth a notification: any leadership role, anything closing within
 * the week, and very strong matches.
 */
export function findAlerts(opts: FindOptions = {}): Alert[] {
  const strongScore = opts.strongScore ?? 55;
  const rows = getDb()
    .prepare(
      `SELECT * FROM jobs
        WHERE is_pe = 1 AND status = 'open'
        ${opts.includeAlerted ? "" : "AND alerted_at IS NULL"}
        ORDER BY pe_score DESC`,
    )
    .all() as unknown as JobRow[];

  const alerts: Alert[] = [];

  for (const job of rows) {
    const daysLeft = daysUntil(job.deadline_at);
    const reasons: AlertReason[] = [];

    if (LEADERSHIP.has(job.pe_seniority ?? "")) reasons.push("leadership");
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= CLOSING_SOON_DAYS) reasons.push("closing");
    if (job.pe_score >= strongScore && !reasons.length) reasons.push("strong");

    if (reasons.length) alerts.push({ job, reasons, daysLeft });
  }

  // Most urgent first: leadership, then whatever closes soonest.
  return alerts.sort((a, b) => {
    const lead = Number(b.reasons.includes("leadership")) - Number(a.reasons.includes("leadership"));
    if (lead) return lead;
    const ad = a.daysLeft ?? 999;
    const bd = b.daysLeft ?? 999;
    return ad - bd || b.job.pe_score - a.job.pe_score;
  });
}

export function markAlerted(jobIds: string[]): void {
  if (!jobIds.length) return;
  const d = getDb();
  const stmt = d.prepare("UPDATE jobs SET alerted_at = ? WHERE id = ?");
  const now = new Date().toISOString();
  d.exec("BEGIN");
  try {
    for (const id of jobIds) stmt.run(now, id);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

const SENIORITY_LABEL: Record<string, string> = {
  director_of_sport: "Director of Sport",
  head_of_department: "Head of Department",
  second_in_department: "2nd in Department",
  coordinator: "Coordinator",
  teacher: "Teacher",
  coach: "Coach",
  support: "Support",
};

function salaryText(row: JobRow): string {
  const s = parseJsonColumn<Salary | null>(row.salary_json, null);
  if (!s) return "";
  if (s.min == null && s.max == null) return s.text ? ` · ${s.text.slice(0, 60)}` : "";
  const n = (v: number) => v.toLocaleString("en-GB");
  const range = s.min != null && s.max != null ? `${n(s.min)}–${n(s.max)}` : n((s.min ?? s.max)!);
  return ` · ${s.currency ?? ""} ${range}`.trimEnd();
}

/** A notification body. Markdown, because that is what a GitHub issue renders. */
export function formatAlerts(alerts: Alert[], siteUrl?: string): string {
  if (!alerts.length) return "No new PE vacancies worth flagging.";

  const leadership = alerts.filter((a) => a.reasons.includes("leadership"));
  const closing = alerts.filter((a) => !a.reasons.includes("leadership") && a.reasons.includes("closing"));
  const strong = alerts.filter((a) => a.reasons.length === 1 && a.reasons[0] === "strong");

  const line = (a: Alert): string => {
    const j = a.job;
    const where = [j.city, j.country].filter(Boolean).join(", ");
    const level = SENIORITY_LABEL[j.pe_seniority ?? ""] ?? "";
    const due =
      a.daysLeft === null ? ""
      : a.daysLeft <= 0 ? " · **closes today**"
      : a.daysLeft <= CLOSING_SOON_DAYS ? ` · **${a.daysLeft}d left**`
      : ` · ${a.daysLeft}d left`;
    return `- [${j.title}](${j.url}) — ${j.school_name ?? "unknown school"}${where ? `, ${where}` : ""}` +
      `${level ? ` · ${level}` : ""}${due}${salaryText(j)}`;
  };

  const parts: string[] = [];
  if (leadership.length) {
    parts.push(`### Leadership roles (${leadership.length})\n\n${leadership.map(line).join("\n")}`);
  }
  if (closing.length) {
    parts.push(`### Closing within ${CLOSING_SOON_DAYS} days (${closing.length})\n\n${closing.map(line).join("\n")}`);
  }
  if (strong.length) {
    // The tail can be long; show a readable slice and be explicit about it.
    const shown = strong.slice(0, 15);
    const count = shown.length < strong.length ? `${shown.length} of ${strong.length}` : String(strong.length);
    parts.push(`### Other strong matches (${count})\n\n${shown.map(line).join("\n")}`);
  }
  if (siteUrl) parts.push(`\n[See everything →](${siteUrl})`);

  return parts.join("\n\n");
}

/** One-line summary, for a notification title. */
export function summariseAlerts(alerts: Alert[]): string {
  const leadership = alerts.filter((a) => a.reasons.includes("leadership")).length;
  const closing = alerts.filter((a) => a.reasons.includes("closing")).length;
  const bits: string[] = [];
  if (leadership) bits.push(`${leadership} leadership`);
  if (closing) bits.push(`${closing} closing soon`);
  if (!bits.length) bits.push(`${alerts.length} new`);
  return `PE jobs: ${bits.join(", ")}`;
}
