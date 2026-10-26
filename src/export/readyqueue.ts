/**
 * The letters that need nothing from a person, laid out for whoever (or
 * whatever) does the Gmail clicking.
 *
 * A letter is ready only when it is complete AND true: an address, no flags,
 * a fact held for this school alone, nobody written to or ruled out already.
 * Anything else stays on the Email tab for a human. The file is written under
 * data/, which is gitignored — the repo is public and this holds real
 * recipients and the path to the CV.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRecipients, type Recipient } from "./recipients.ts";
import type { SchoolRow } from "../store/db.ts";

export const READY_QUEUE_PATH = join(process.cwd(), "data", "ready-queue.json");
export const SHEET_QUEUE_PATH = join(process.cwd(), "data", "sheet-queue.csv");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The marked letter as Gmail-pasteable HTML: bold where bold, "my website" as a real link. */
export function letterHtml(marked: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/my website: (https?:\/\/[^\s<]+)/, (_m, u: string) => `<a href="${u}">my website</a>.`);
  const out: string[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.join("<br>")}</p>`); para = []; };
  const flushBullets = () => { if (bullets.length) out.push(`<ul>${bullets.join("")}</ul>`); bullets = []; };
  for (const line of marked.split("\n")) {
    if (line.startsWith("• ")) { flushPara(); bullets.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    flushBullets();
    if (line === "") flushPara(); else para.push(inline(line));
  }
  flushPara(); flushBullets();
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${out.join("")}</div>`;
}

/** Why a recipient is not ready, or null when it is. */
export function notReadyReason(r: Recipient): string | null {
  if (r.missing.length) return `no letter: ${r.missing.join("; ")}`;
  if (r.flags.length) return `needs a check: ${r.flags[0]}`;
  if (r.factQuality !== "unique") return "no fact held for this school alone";
  // An age, an accreditation or a facility is not a reason to want to work somewhere; a value the school states is.
  if (!r.brief.schoolFact?.startsWith("states its")) return "no value line from the school yet";
  if (r.lastSent) return "already written to";
  if (r.skipped) return "marked not interested";
  if (r.appliedRecently) return "applied within 60 days";
  return null;
}

export function writeReadyQueue(
  schools: SchoolRow[],
  cvPath: string | undefined,
  limit: number,
): { ready: number; readyTotal: number; notReady: number; cvOk: boolean; path: string } {
  const recipients = buildRecipients(schools);
  const readyAll = recipients.filter((r) => !notReadyReason(r));
  const ready = readyAll.slice(0, limit);
  const cvOk = !!cvPath && existsSync(cvPath);

  const queue = {
    generated: new Date().toISOString(),
    cv: cvPath ?? null,
    cvFound: cvOk,
    howTo: [
      "For each item, in order: open Gmail compose.",
      "To = to, Subject = subject. Click into the body and paste bodyHtml as formatted text (not plain text) so 'my website' stays a link.",
      "Attach the file at cv. Check the attachment chip appears.",
      "Stop before Send unless you were told to press it. After a real send, run: npm run mark-sent -- <to>",
    ],
    letters: ready.map((r) => ({
      to: r.email,
      subject: r.subject,
      school: r.schools.map((s) => s.name).join(" / "),
      bodyHtml: letterHtml(r.marked),
      bodyText: r.body,
      afterSend: `npm run mark-sent -- ${r.email}`,
    })),
  };
  writeFileSync(READY_QUEUE_PATH, JSON.stringify(queue, null, 2));
  // For the Apps Script mailer: tab "Schools", columns by position A School, B Email, C Letter, D Sent (left empty).
  const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
  // Every school: a letter only when nothing is missing or flagged, so the mailer never sends a broken one;
  // Sent is pre-filled for anyone already written to or ruled out, so the script skips them.
  // One row per school (a group address repeats on each of its schools); E says plainly whether it was sent.
  // shortcut: the sent log keeps the date only, so E has no time for past sends; the script's own D stamp has it.
  const rows: string[][] = recipients.flatMap((r) => r.schools.map((s) => [
    s.name, r.email,
    r.missing.length || r.flags.length ? "" : r.body,
    r.lastSent ? r.lastSent.date : r.skipped ? "not interested" : "",
    r.lastSent ? `yes, ${r.lastSent.date}` : "no",
  ]));
  const covered = new Set(recipients.flatMap((r) => r.schools.map((s) => s.school_key)));
  for (const s of schools) if (!covered.has(s.school_key)) rows.push([s.name, "", "", "", "no"]);
  writeFileSync(SHEET_QUEUE_PATH, ["School,Email,Letter,Sent,Already sent", ...rows.map((r) => r.map(cell).join(","))].join("\n"));
  return { ready: ready.length, readyTotal: readyAll.length, notReady: recipients.length - readyAll.length, cvOk, path: READY_QUEUE_PATH };
}
