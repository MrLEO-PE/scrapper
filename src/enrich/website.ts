/**
 * Targeted crawl of a school's own website.
 *
 * This is the "deep search" for the careers contact: the address is rarely on
 * the homepage, often on a careers/vacancies page, and quite frequently only
 * inside a job-pack PDF linked from one. We therefore walk a small, prioritised
 * frontier rather than crawling the whole site — typically 6-10 pages plus any
 * PDFs that look like recruitment documents.
 *
 * Everything goes through the shared HTTP client, so robots.txt, the crawl
 * delay and the cache all apply.
 */

import { extractSocial, isNeverFetch, type SocialLink } from "./social.ts";
import { fetchBuffer, fetchText } from "../core/http.ts";
import { log } from "../core/logger.ts";
import { htmlToText } from "../core/text.ts";
import type { DiscoveredEmail } from "../core/types.ts";
import { extractEmails, mergeEmails } from "./email.ts";
import {
  countPeStaff,
  extractCurriculum,
  extractPackage,
  extractPeTeamSize,
  extractPhase,
  extractStudentCount,
  type Extracted,
} from "./facts.ts";
import { pdfToText } from "./pdf.ts";
import { findPeHook, findPrincipal, findSchoolHook, type Hook } from "./hooks.ts";
import { extractSalaryFromText, type SourcedSalary } from "./salary.ts";

/** Link scoring: higher = crawl sooner. */
const LINK_PRIORITIES: { re: RegExp; score: number; tag: string }[] = [
  { re: /(?:^|[\/\-_])(?:careers?|vacanc(?:y|ies)|recruit(?:ment)?|employment|job-?opportunities|jobs?|work-?(?:with|for)-?us|join-?(?:us|our-?team)|hiring|opportunities)(?:[\/\-_.?#]|$)/i, score: 100, tag: "careers" },
  { re: /(?:^|[\/\-_])(?:work-?here|staff-?vacancies|teaching-?vacancies|current-?vacancies|apply)(?:[\/\-_.?#]|$)/i, score: 95, tag: "careers" },
  { re: /(?:^|[\/\-_])(?:contact|contact-?us|get-?in-?touch|enquir)/i, score: 75, tag: "contact" },
  // Staff directories and PE department pages are the only places a PE team
  // size is ever countable, so they outrank the general "about" pages.
  { re: /(?:^|[\/\-_])(?:staff|faculty|our-?team|meet-?the-?team|leadership|senior-?leadership|directory|people)/i, score: 72, tag: "staff" },
  { re: /(?:^|[\/\-_])(?:pe|physical-?education|sport|sports|athletics|games)(?:[\/\-_.?#]|$)/i, score: 70, tag: "staff" },
  { re: /(?:^|[\/\-_])(?:about|about-?us|our-?school|who-?we-?are|welcome|overview|at-?a-?glance|fast-?facts|key-?facts)/i, score: 60, tag: "about" },
  { re: /(?:^|[\/\-_])(?:curriculum|academics|programmes?|programs?)/i, score: 40, tag: "curriculum" },
  { re: /(?:^|[\/\-_])(?:admissions?|fees|prospectus)/i, score: 30, tag: "admissions" },
];

/** PDFs worth opening — recruitment packs and prospectuses. */
const PDF_WORTH_READING =
  /(?:job|vacanc|recruit|career|application|candidate|appointment|post|role|pack|prospectus|information|staff|teacher|pe|sport)/i;

export interface SiteFindings {
  emails: DiscoveredEmail[];
  careersPageUrl?: string;
  studentCount?: Extracted<number>;
  peTeamSize?: Extracted<number>;
  curriculum?: Extracted<string[]>;
  phase?: ReturnType<typeof extractPhase>;
  packageNotes?: Extracted<string[]>;
  pagesVisited: number;
  pdfsRead: number;
  notes: string[];
  /** Details an application email needs, taken from the school's own pages. */
  principal?: Hook;
  schoolHook?: Hook;
  peHook?: Hook;
  /** The school's own social pages, for the reader to open. Never fetched. */
  social: SocialLink[];
  /** A pay figure published on the school site or in a job pack. */
  salary?: SourcedSalary;
}

interface Candidate {
  url: string;
  score: number;
  tag: string;
}

/** Extract absolute links with their anchor text. */
function linksFrom(html: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1]!.trim();
    if (!href || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const abs = new URL(href, base);
      abs.hash = "";
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      out.push({ url: abs.href, text: htmlToText(m[2] ?? "").slice(0, 120) });
    } catch {
      /* unparseable href */
    }
  }
  return out;
}

function scoreLink(url: string, text: string): { score: number; tag: string } | null {
  const haystack = url + " " + text;
  for (const p of LINK_PRIORITIES) {
    if (p.re.test(haystack)) return { score: p.score, tag: p.tag };
  }
  return null;
}

function normaliseSite(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : "https://" + raw);
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

export interface CrawlOptions {
  maxPages?: number;
  maxPdfs?: number;
  fresh?: boolean;
  /**
   * Wall-clock budget for one school, in ms. School websites vary wildly —
   * some are dead, some sit behind slow CDNs — and without a ceiling a single
   * bad host can stall the whole run.
   */
  budgetMs?: number;
  /** Used to stop the school's own name being read as a person. */
  schoolName?: string;
}

export async function crawlSchoolSite(
  siteUrl: string,
  opts: CrawlOptions = {},
): Promise<SiteFindings | null> {
  const schoolName = opts.schoolName ?? "";
  const maxPages = opts.maxPages ?? 8;
  const maxPdfs = opts.maxPdfs ?? 3;
  const deadline = Date.now() + (opts.budgetMs ?? 90_000);
  // School sites are unreliable; one quick retry, then move on.
  const net = { retries: 1, soft: true as const, fresh: opts.fresh };

  const start = normaliseSite(siteUrl);
  if (!start) return null;

  /*
   * A school whose only presence is a Facebook page will have that link stored
   * where a website would go, so the refusal has to be by host here rather
   * than by trusting the caller. Meta's and LinkedIn's terms prohibit
   * automated collection; the link is for the reader to open, not for us.
   */
  if (isNeverFetch(start)) {
    return {
      emails: [], social: [], pagesVisited: 0, pdfsRead: 0,
      notes: ["social page, not crawled — open it yourself; automated collection there is not permitted"],
    };
  }

  const findings: SiteFindings = { emails: [], social: [], pagesVisited: 0, pdfsRead: 0, notes: [] };
  const origin = new URL(start).origin;
  const visited = new Set<string>();
  const pdfQueue: Candidate[] = [];

  // Homepage first, then whatever the frontier ranks highest.
  const frontier: Candidate[] = [{ url: start, score: 1000, tag: "home" }];
  // Text gathered across the whole site, for facts that may appear anywhere.
  let corpus = "";
  let careersText = "";
  // Staff and PE-department pages only. Counting PE role mentions is a valid
  // headcount proxy here and nowhere else.
  let staffText = "";

  while (frontier.length && findings.pagesVisited < maxPages && Date.now() < deadline) {
    frontier.sort((a, b) => b.score - a.score);
    const next = frontier.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    const html = await fetchText(next.url, { ...net, timeoutMs: 12000, label: `site ${next.url}` });
    if (!html) continue;
    findings.pagesVisited++;

    const text = htmlToText(html);
    corpus += "\n" + text;
    if (next.tag === "careers") {
      findings.careersPageUrl ??= next.url;
      careersText += "\n" + text;
    } else if (next.tag === "staff") {
      staffText += "\n" + text;
    }

    // Details for the application email. Taken per page so each one records
    // the page it actually came from, and first confident hit wins.
    findings.salary ??= extractSalaryFromText(text, "school-site") ?? undefined;
    findings.principal ??= findPrincipal(html, next.url, schoolName) ?? undefined;
    findings.schoolHook ??= findSchoolHook(html, next.url) ?? undefined;
    // Sport facilities are as often on the homepage or "about" page as on a
    // dedicated PE page, and the hook must name something concrete anyway, so
    // every page is worth checking.
    findings.peHook ??= findPeHook(html, next.url) ?? undefined;

    // Emails from the page body and from any mailto: links.
    const pageEmails = extractEmails(text, next.url, "html");
    const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) =>
      decodeURIComponent(m[1]!),
    );
    findings.emails = mergeEmails(
      findings.emails,
      pageEmails,
      extractEmails(mailtos.join(" "), next.url, "html"),
    );

    // The school's own social pages, almost always linked from the footer.
    // Recorded as somewhere for the reader to look, never fetched.
    findings.social.push(...extractSocial(html));

    // Queue further pages, staying on this origin.
    for (const link of linksFrom(html, next.url)) {
      if (visited.has(link.url)) continue;

      if (/\.pdf(?:$|\?)/i.test(link.url)) {
        if (PDF_WORTH_READING.test(link.url + " " + link.text)) {
          const bonus = next.tag === "careers" ? 40 : 0;
          pdfQueue.push({ url: link.url, score: 50 + bonus, tag: "pdf" });
        }
        continue;
      }
      if (!link.url.startsWith(origin)) continue;
      if (/\.(?:jpg|jpeg|png|gif|webp|svg|css|js|zip|docx?|xlsx?|pptx?|mp4|mp3)(?:$|\?)/i.test(link.url)) continue;

      const scored = scoreLink(link.url, link.text);
      if (scored) frontier.push({ url: link.url, score: scored.score, tag: scored.tag });
    }
  }

  // Read the most promising recruitment PDFs.
  const seenPdf = new Set<string>();
  pdfQueue.sort((a, b) => b.score - a.score);
  for (const pdf of pdfQueue) {
    if (findings.pdfsRead >= maxPdfs || Date.now() > deadline) break;
    if (seenPdf.has(pdf.url)) continue;
    seenPdf.add(pdf.url);

    const buf = await fetchBuffer(pdf.url, { ...net, timeoutMs: 25000 });
    if (!buf) continue;
    // Guard against multi-hundred-MB prospectuses.
    if (buf.length > 25 * 1024 * 1024) {
      findings.notes.push(`skipped oversized PDF ${pdf.url}`);
      continue;
    }

    const text = pdfToText(buf);
    findings.pdfsRead++;
    if (!text) {
      findings.notes.push(`no text layer in ${pdf.url}`);
      continue;
    }
    corpus += "\n" + text;
    careersText += "\n" + text;
    findings.emails = mergeEmails(findings.emails, extractEmails(text, pdf.url, "pdf"));
    // Pay scales are often published only inside a job pack.
    findings.salary ??= extractSalaryFromText(text, "job-pack") ?? undefined;
    log.debug(`pdf ${pdf.url}: ${text.length} chars, ${findings.emails.length} emails so far`);
  }

  if (Date.now() >= deadline) findings.notes.push(`crawl stopped at the time budget after ${findings.pagesVisited} pages`);

  // Facts: prefer careers-page text where it exists, fall back to the corpus.
  const both = (careersText + "\n" + corpus).slice(0, 600_000);
  findings.studentCount = extractStudentCount(both) ?? undefined;
  findings.curriculum = extractCurriculum(both) ?? undefined;
  findings.phase = extractPhase(both) ?? undefined;
  findings.packageNotes = extractPackage(careersText || both) ?? undefined;
  // An explicit statement anywhere on the site is trusted; otherwise fall back
  // to counting PE roles, but only on staff/department pages.
  findings.peTeamSize =
    extractPeTeamSize(both) ?? (staffText ? countPeStaff(staffText) ?? undefined : undefined);

  return findings;
}
