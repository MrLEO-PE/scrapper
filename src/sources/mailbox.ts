/**
 * Job alerts arriving by email.
 *
 * The strong paid services — Search Associates, ISS EDUrecruit, TIE Online,
 * Schrole — put their value behind a login, and scraping a members' area you
 * pay for is both fragile and against their terms. What they all do is email
 * you matching vacancies. That email is the sanctioned feed, so this source
 * reads it.
 *
 * Drop `.eml` files into `data/inbox/` and they are parsed, classified and
 * merged with everything else. Any mail client can save a message as `.eml`;
 * the README describes a Gmail filter that does it without manual work.
 *
 * Implemented as a small MIME reader — enough for the multipart/alternative,
 * quoted-printable and base64 that mail generators actually produce.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import { decodeEntities, htmlToText, slugify, toIso } from "../core/text.ts";
import type { RawJob } from "../core/types.ts";
import { classify } from "../match/classify.ts";
import type { ScrapeContext, Source } from "./base.ts";

export const INBOX_DIR = process.env.SCRAPPER_INBOX || join(process.cwd(), "data", "inbox");

/** Recognised senders, so a row can say where the alert came from. */
const SENDERS: { re: RegExp; label: string }[] = [
  { re: /searchassociates\.com/i, label: "Search Associates" },
  { re: /\biss\.edu\b|edurecruit/i, label: "ISS EDUrecruit" },
  { re: /tieonline\.com/i, label: "TIE Online" },
  { re: /schrole\.com/i, label: "Schrole" },
  { re: /internationalschoolcommunity\.com/i, label: "International School Community" },
  { re: /teachingnomad\.com/i, label: "Teaching Nomad" },
  { re: /tes\.com/i, label: "TES alert" },
  { re: /teachaway\.com/i, label: "Teach Away alert" },
  { re: /linkedin\.com/i, label: "LinkedIn alert" },
  { re: /indeed\.com/i, label: "Indeed alert" },
  /*
   * Boards that matter for the configured countries. None can be scraped —
   * some forbid it, some are behind Cloudflare, some need a browser — but all
   * of them will email you, and an email is a sanctioned feed. Signing up to
   * these is the cheapest coverage available: no code runs until a message
   * arrives, and the parser treats them like any other source.
   */
  { re: /ajarn\.com/i, label: "Ajarn (Thailand)" },
  { re: /vietnamteachingjobs\.com/i, label: "Vietnam Teaching Jobs" },
  { re: /seekteachers\.com/i, label: "SeekTeachers" },
  { re: /edvectus\.com/i, label: "Edvectus" },
  { re: /chinateachjobs\.com|teachingjobchina\.com/i, label: "China Teach Jobs" },
  { re: /gaijinpot\.com/i, label: "GaijinPot (Japan)" },
  { re: /toptutorjob\.com/i, label: "TopTutorJob" },
  { re: /fobisia\.org/i, label: "FOBISIA" },
  { re: /cois\.org|councilofinternationalschools/i, label: "CIS Careers" },
  { re: /jobs\.tes\.com|eteach\.com/i, label: "Eteach alert" },
];

interface ParsedMail {
  from: string;
  subject: string;
  date?: string;
  html: string;
  text: string;
}

/** Split a raw message into headers and body, unfolding continuation lines. */
function splitMessage(raw: string): { headers: Map<string, string>; body: string } {
  const normalised = raw.replace(/\r\n/g, "\n");
  const blank = normalised.indexOf("\n\n");
  const headerBlock = blank === -1 ? normalised : normalised.slice(0, blank);
  const body = blank === -1 ? "" : normalised.slice(blank + 2);

  const headers = new Map<string, string>();
  // A header value continues while following lines begin with whitespace.
  const unfolded = headerBlock.replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body };
}

function decodeQuotedPrintable(s: string): string {
  return s
    // Soft line breaks.
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function decodeBody(body: string, encoding?: string, charset?: string): string {
  const enc = (encoding ?? "").toLowerCase();
  let bytes: Buffer;

  if (enc.includes("base64")) {
    bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  } else if (enc.includes("quoted-printable")) {
    bytes = Buffer.from(decodeQuotedPrintable(body), "latin1");
  } else {
    bytes = Buffer.from(body, "latin1");
  }

  const cs = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(cs.includes("iso-8859") || cs.includes("windows-125") ? "latin1" : "utf-8", {
      fatal: false,
    }).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

/** Decode RFC 2047 encoded words in a header ("=?utf-8?B?...?="). */
function decodeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_, charset: string, kind: string, data: string) => {
      const raw =
        kind.toLowerCase() === "b"
          ? Buffer.from(data, "base64")
          : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "latin1");
      try {
        return new TextDecoder(charset.toLowerCase().includes("iso-8859") ? "latin1" : "utf-8", {
          fatal: false,
        }).decode(raw);
      } catch {
        return raw.toString("utf8");
      }
    },
  );
}

const paramOf = (header: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, "i").exec(header)?.[1]?.trim();

/** Walk a message (recursing through multipart) collecting html and text. */
function collectParts(body: string, contentType: string, encoding: string, acc: { html: string; text: string }): void {
  const type = contentType.toLowerCase();

  if (type.startsWith("multipart/")) {
    const boundary = paramOf(contentType, "boundary");
    if (!boundary) return;
    const marker = `--${boundary}`;

    for (const chunk of body.split(marker)) {
      const piece = chunk.replace(/^\r?\n/, "");
      if (!piece.trim() || piece.startsWith("--")) continue;

      const { headers, body: sub } = splitMessage(piece);
      collectParts(
        sub,
        headers.get("content-type") ?? "text/plain",
        headers.get("content-transfer-encoding") ?? "",
        acc,
      );
    }
    return;
  }

  const decoded = decodeBody(body, encoding, paramOf(contentType, "charset"));
  if (type.includes("text/html")) acc.html += "\n" + decoded;
  else if (type.includes("text/plain")) acc.text += "\n" + decoded;
}

export function parseEml(raw: string): ParsedMail {
  const { headers, body } = splitMessage(raw);
  const acc = { html: "", text: "" };
  collectParts(
    body,
    headers.get("content-type") ?? "text/plain",
    headers.get("content-transfer-encoding") ?? "",
    acc,
  );

  return {
    from: decodeHeader(headers.get("from") ?? ""),
    subject: decodeHeader(headers.get("subject") ?? ""),
    date: headers.get("date"),
    html: acc.html,
    text: acc.text,
  };
}

function senderLabel(from: string, subject: string): string {
  const hay = `${from} ${subject}`;
  for (const s of SENDERS) if (s.re.test(hay)) return s.label;
  const domain = /@([\w.-]+)/.exec(from)?.[1];
  return domain ? `Email alert (${domain})` : "Email alert";
}

/** Tracking wrappers and unsubscribe links are not vacancies. */
const NOT_A_JOB_LINK =
  /(?:unsubscribe|preferences|privacy|\/profile|\/login|\/account|facebook\.com|twitter\.com|x\.com|linkedin\.com\/company|instagram\.com|youtube\.com|\.png|\.jpg|\.gif)/i;

const ROLE_SHAPED =
  /\b(?:teacher|teaching|head\s+of|director\s+of|coordinator|co-ordinator|instructor|coach|leader|specialist|hod|vacancy|position)\b/i;

/**
 * Pull candidate vacancies out of one alert.
 *
 * Alert layouts vary, so two passes: linked titles from the HTML, then
 * role-shaped lines from the plain-text alternative.
 */
function jobsFromMail(mail: ParsedMail, file: string): RawJob[] {
  const service = senderLabel(mail.from, mail.subject);
  const posted = toIso(mail.date);
  const out = new Map<string, RawJob>();

  const add = (title: string, url: string): void => {
    const clean = title.replace(/\s+/g, " ").trim();
    if (clean.length < 6 || clean.length > 160) return;
    if (!ROLE_SHAPED.test(clean)) return;
    if (!classify(clean).isPe) return;

    const id = `${slugify(service)}-${slugify(clean).slice(0, 70)}`;
    if (out.has(id)) return;
    out.set(id, {
      source: "mailalert",
      sourceJobId: id,
      title: clean,
      url: url || `mailto:?subject=${encodeURIComponent(clean)}`,
      postedAt: posted,
      description: `From a ${service} email alert (${file}).`,
      raw: { service, file, subject: mail.subject },
    });
  };

  // Linked titles.
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mail.html))) {
    const url = decodeEntities(m[1]!.trim());
    if (NOT_A_JOB_LINK.test(url)) continue;
    add(htmlToText(m[2] ?? ""), url);
  }

  // Plain-text lines, for alerts with no useful markup.
  const plain = mail.text || htmlToText(mail.html);
  for (const line of plain.split(/\n+/)) {
    const text = line.replace(/^[\s•\-*>]+/, "").trim();
    if (!text) continue;
    const link = /(https?:\/\/\S+)/.exec(text)?.[1] ?? "";
    add(text.replace(/https?:\/\/\S+/g, "").trim(), link);
  }

  return [...out.values()];
}

export const mailboxSource: Source = {
  id: "mailalert",
  label: "Email alerts",
  note: `Reads .eml files from ${INBOX_DIR} — the sanctioned feed from Search Associates, ISS, TIE and Schrole.`,

  async collect(_ctx: ScrapeContext): Promise<RawJob[]> {
    if (!existsSync(INBOX_DIR)) {
      log.info(`no inbox yet — create ${INBOX_DIR} and drop job-alert .eml files in it`);
      return [];
    }

    const files = readdirSync(INBOX_DIR).filter((f) => /\.(eml|txt|mht)$/i.test(f));
    if (!files.length) {
      log.info(`inbox is empty (${INBOX_DIR})`);
      return [];
    }

    const out = new Map<string, RawJob>();
    let read = 0;

    for (const file of files) {
      try {
        const raw = readFileSync(join(INBOX_DIR, file), "utf8");
        const mail = parseEml(raw);
        const jobs = jobsFromMail(mail, file);
        for (const job of jobs) out.set(job.sourceJobId, job);
        read++;
        log.debug(`${file}: ${jobs.length} PE-linked (${mail.subject.slice(0, 60)})`);
      } catch (err) {
        log.warn(`could not read ${file}: ${(err as Error).message}`);
      }
    }

    log.info(`email alerts: ${out.size} PE-linked vacancies from ${read} message${read === 1 ? "" : "s"}`);
    return [...out.values()];
  },
};
