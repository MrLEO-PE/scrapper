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
import { findPeople, type Person } from "./people.ts";
import { extractSalaryFromText, type SourcedSalary } from "./salary.ts";

/** Link scoring: higher = crawl sooner. */
/*
 * Where each rule ends matters as much as what it matches.
 *
 * These are tested against `url + " " + anchorText`, so a keyword at the end of
 * a URL is followed by a space, not the end of the string. An `$` anchor here
 * therefore never fires, and `/vacancies`, `/employment`, `/current-vacancies`
 * and `/work-with-us` all scored nothing at all — the crawler never gave the
 * page a school advertises its posts on any priority. A negative lookahead
 * covers the space, the end and the punctuation together.
 *
 * The same held at the front: `(?:^|[\/\-_])` does not admit a space either, so
 * a link whose URL is opaque and whose text reads "Current vacancies" matched
 * nothing. The two careers rules use a symmetric word boundary because they
 * decide the crawler's first and most valuable page. The rules below keep the
 * original path-segment boundary on purpose — loosening all of them would
 * reshuffle the whole frontier for no established gain.
 */
const LINK_PRIORITIES: { re: RegExp; score: number; tag: string }[] = [
  { re: /(?<![A-Za-z0-9])(?:careers?|vacanc(?:y|ies)|recruit(?:ment)?|employment(?:-?opportunities)?|job-?opportunities|jobs?|work(?:ing)?-?(?:with|for)-?us|join-?(?:us|our-?team)|hiring|opportunities)(?![A-Za-z0-9])/i, score: 100, tag: "careers" },
  { re: /(?<![A-Za-z0-9])(?:work-?here|staff-?vacancies|teaching-?vacancies|current-?vacancies|apply)(?![A-Za-z0-9])/i, score: 95, tag: "careers" },
  { re: /(?:^|[\/\-_])(?:contact|contact-?us|get-?in-?touch|enquir)/i, score: 75, tag: "contact" },
  // Staff directories and PE department pages are the only places a PE team
  // size is ever countable, so they outrank the general "about" pages.
  { re: /(?:^|[\/\-_])(?:staff|faculty|our-?team|meet-?the-?team|leadership|senior-?leadership|directory|people)/i, score: 72, tag: "staff" },
  { re: /(?:^|[\/\-_])(?:pe|physical-?education|sport|sports|athletics|games)(?![A-Za-z0-9])/i, score: 70, tag: "staff" },
  { re: /(?:^|[\/\-_])(?:about|about-?us|our-?school|who-?we-?are|welcome|overview|at-?a-?glance|fast-?facts|key-?facts)/i, score: 60, tag: "about" },
  /*
   * The rest exist because the crawl now has the budget to reach them, and
   * each carries one of the columns that is still thin.
   */
  // Who leads the school — the Prepared Email needs a name, and a welcome
  // letter from the head is where it is signed.
  { re: /(?:^|[\/\-_])(?:head-?of-?school|headmaster|headmistress|principal|our-?principal|head-?teacher|senior-?team|leadership-?team|governance|our-?people|meet-?our)/i, score: 78, tag: "staff" },
  // What the school offers a teacher: the package column.
  { re: /(?:^|[\/\-_])(?:benefits|remuneration|package|why-?(?:work|join|choose)|working-?(?:at|with|here)|life-?at|staff-?benefits|professional-?development|cpd)/i, score: 76, tag: "careers" },
  // Facilities and co-curricular pages are where a concrete PE fact lives.
  { re: /(?:^|[\/\-_])(?:facilities|our-?facilities|campus(?:es)?|co-?curricular|extra-?curricular|activities|ccas?|clubs|swimming|aquatics)/i, score: 68, tag: "staff" },
  // Accreditation and ethos pages carry the school fact the email opens with.
  { re: /(?:^|[\/\-_])(?:accreditation|accredited|mission|vision|values|ethos|our-?story|history|awards)/i, score: 62, tag: "about" },
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
  /**
   * Named staff worth writing to, from every page visited.
   *
   * Most schools publish no careers address but nearly all publish a
   * leadership page, so for a speculative application this is the route to a
   * human at the schools that would otherwise be a dead end.
   */
  people: Person[];
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

/**
 * "Careers" at a school usually means the pupils' careers, not ours.
 *
 * A careers-and-university-guidance page, a careers counsellor, a careers fair
 * — these advise pupils on where to study next, and they match the recruitment
 * patterns above word for word. The email classifier already refuses a student
 * careers adviser's address; without the same guard on links, the crawler spent
 * its highest-priority slot on the wrong page at 89 schools and recorded that
 * page as where to apply for a job.
 *
 * Demoted rather than dropped: these pages are still worth reading late, and a
 * school whose only careers-ish page is this one has genuinely told us it does
 * not advertise posts.
 */
const STUDENT_GUIDANCE =
  /careers?[\s\-_]?(?:and|&|amp;)[\s\-_]?(?:universit(?:y|ies)|uni|college|higher)|(?:universit(?:y|ies)|uni|college|higher[\s\-_]?ed)[\s\-_]?(?:and|&|amp;)?[\s\-_]?careers?|careers?[\s\-_](?:guidance|advice|advis(?:e|o)r|counsell?(?:ing|or)|programme|program|education|fair|day|week|centre|center|hub|lesson|curriculum|readiness)|(?:guidance|counsell?(?:ing|or)|advis(?:e|o)r)[\s\-_]?(?:and|&|amp;)?[\s\-_]?careers?|student[\s\-_]?careers?|careers?[\s\-_]?(?:in|for)[\s\-_]?(?:sport|medicine|stem|law)|college[\s\-_]?placement|university[\s\-_]?(?:destination|placement|counsel)|career[\s\-_]?(?:and|&|amp;)[\s\-_]?technical|technical[\s\-_]?(?:and|&|amp;)[\s\-_]?career/i;

export function scoreLink(url: string, text: string): { score: number; tag: string } | null {
  const haystack = url + " " + text;
  for (const p of LINK_PRIORITIES) {
    if (!p.re.test(haystack)) continue;
    // A pupils' careers page must not outrank the school's real vacancy page,
    // and must never be reported as the place to apply.
    if (p.tag === "careers" && STUDENT_GUIDANCE.test(haystack)) {
      return { score: 35, tag: "about" };
    }
    return { score: p.score, tag: p.tag };
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
  /*
   * Deliberately generous.
   *
   * Finding a school's website is the hard part and it is now mostly solved;
   * once we have one, being thorough costs only time, and this runs unattended
   * on a schedule. Eight pages was tuned when the crawl ran against every
   * school in a nightly window — it routinely stopped before reaching the
   * contact page, which is where the address usually is.
   *
   * Twenty-five pages with a four-minute ceiling reaches the careers page, the
   * contact page, the staff directory and the PE pages on all but the largest
   * sites, and still cannot hang: the deadline is absolute.
   */
  const maxPages = opts.maxPages ?? 25;
  const maxPdfs = opts.maxPdfs ?? 6;
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
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
      emails: [], social: [], people: [], pagesVisited: 0, pdfsRead: 0,
      notes: ["social page, not crawled — open it yourself; automated collection there is not permitted"],
    };
  }

  const findings: SiteFindings = { emails: [], social: [], people: [], pagesVisited: 0, pdfsRead: 0, notes: [] };
  const origin = new URL(start).origin;
  const visited = new Set<string>();
  const pdfQueue: Candidate[] = [];

  /*
   * Homepage first, then a handful of guessed careers/contact paths.
   *
   * The crawl otherwise only reaches these pages by finding a link to them,
   * and plenty of sites — JS-built ones especially — don't put "Careers" or
   * "Contact" in HTML the link-text scanner can see, even though the page
   * exists at exactly the URL you'd expect. Guessing costs one fetch each,
   * most of which 404 harmlessly, so it is worth doing unconditionally rather
   * than only when discovery comes up empty.
   */
  const GUESSED_PATHS = [
    // Careers, in every phrasing a school site actually uses — kept in sync
    // with the LINK_PRIORITIES "careers" regex above, since a page worth
    // guessing at is a page worth recognising if discovery finds it instead.
    "/careers", "/career", "/careers-opportunities", "/career-opportunities",
    "/vacancies", "/current-vacancies", "/staff-vacancies", "/teaching-vacancies",
    "/jobs", "/job-opportunities", "/employment", "/employment-opportunities",
    "/opportunities", "/recruitment", "/hiring",
    "/work-with-us", "/work-for-us", "/working-with-us", "/working-for-us", "/work-here",
    "/join-us", "/join-our-team", "/joinourteam",
    "/apply", "/staff-openings",
    "/contact", "/contact-us", "/about/contact", "/about-us/contact",
  ];
  const frontier: Candidate[] = [
    { url: start, score: 1000, tag: "home" },
    ...GUESSED_PATHS.map((path) => ({ url: origin + path, score: 90, tag: /contact/.test(path) ? "contact" : "careers" })),
  ];
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
    // Whoever this page names. Free: the page is already fetched, and a
    // leadership page is high in the frontier anyway.
    findings.people.push(...findPeople(html, next.url, schoolName));
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
