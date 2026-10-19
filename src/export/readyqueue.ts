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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The marked letter as Gmail-pasteable HTML: bold where bold, "my website" as a real link. */
export function letterHtml(marked: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/my website: (https?:\/\/[^\s<]+)/, (_m, u: string) => `<a href="${u}">my website</a>`);
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
  if (r.lastSent) return "already written to";
  if (r.skipped) return "marked not interested";
  if (r.appliedRecently) return "applied within 60 days";
  return null;
}

export function writeReadyQueue(
  schools: SchoolRow[],
  cvPath: string | undefined,
  limit: number,
): { ready: number; notReady: number; cvOk: boolean; path: string } {
  const recipients = buildRecipients(schools);
  const ready = recipients.filter((r) => !notReadyReason(r)).slice(0, limit);
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
  return { ready: ready.length, notReady: recipients.length - ready.length, cvOk, path: READY_QUEUE_PATH };
}
