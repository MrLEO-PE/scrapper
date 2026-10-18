/**
 * Finding the address a school wants applications sent to.
 *
 * The general crawl reads whatever pages it reaches and ranks every address by
 * its name alone, so a school that prints "Please send your CV to hr@ise.ac.th"
 * on its careers page could still come back with none, or with the admissions
 * inbox. This reads the careers page itself and asks the question a person
 * would: which address does the page tell me to write to?
 *
 * An address is accepted for one of two reasons, and the reason is kept:
 *
 *   hr     the name says so (hr@, recruitment@, careers@, jobs@, emploi@ …) and
 *          it sits on the school's own careers page
 *   named  the page tells you in words to send your application to it
 *          ("send your CV to …") — often a named person in HR, so it is
 *          flagged for a look rather than trusted as an inbox
 *
 * Admissions, enquiry and info inboxes are never promoted, whatever the page
 * says around them: they are the fallback, not the answer.
 */

import { fetchText } from "../core/http.ts";
import { decodeCloudflareEmails, jsonLdEmails } from "./email.ts";
import { htmlToText } from "../core/text.ts";
import { detectApplicationForm } from "../match/appform.ts";
import type { ApplicationForm } from "../core/types.ts";

/** An address that is about hiring, not about the staff list or the teaching programme. */
const STRONG_URL =
  /career|employment|vacanc|recruit|join-?(us|our|the)|work-?(with|for|at)|working-?(at|with|for)|\/jobs?\b|opportunit|human-?res|\/hr\b|tuyen|emploi|recrut|stellen|karriere|trabaja|empleo/i;

/** A local part that says "this is for people applying for jobs". */
const HR_LOCAL =
  /(^|[._-])(hr[a-z]*|human.?resources?|recruit\w*|career\w*|jobs?|employ\w*|vacanc\w*|personnel|talent|staffing|teachingjobs|tuyendung|emploi|recrutement|recrutamiento|bewerbung|personal)([._-]|$)|^hr|recruit|[a-z]{2,}hr$/i;

/** Inboxes for everyone else. Never the answer to "where do I send my CV". */
const NOT_HR =
  /^(info|information|admission|admissions|admit|enquir\w*|inquir\w*|contact|office|admin|reception|front.?office|webmaster|marketing|alumni|finance|accounts?|noreply|no-reply|press|media|support|hello|principal|headmaster|head|registrar|communications?|concierge|sales|service|secretary|welcome|enrol\w*|tuition|transport|bus|canteen|it|helpdesk)\b/i;

const JUNK = /example|sentry|wixpress|mysite|domain\.com|email\.com|yourname|your-?email|@2x|\.(png|jpe?g|gif|webp|svg|css|js)$/i;

/** Words that tell you to send something to the address that follows them. */
const STRONG_CONTEXT = new RegExp(
  [
    // "send your CV to", "email your application to"
    String.raw`(send|sent|email|e-mail|forward|submit|direct|address)[^.]{0,80}(cv|c\.v\.|resume|résumé|curriculum|application|cover letter|letter of interest)`,
    // "CV to:", "applications at:"
    String.raw`(cv|resume|résumé|application)s?[^.]{0,60}(to|at|via)\s*[:\-]?\s*$`,
    // "send your email to"
    String.raw`(send|forward)\s+(your\s+)?(e-?mail|message|enquiry|inquiry|documents?|materials?|portfolio|details)\s+to\s*[:\-]?\s*$`,
    // "Applying for … E-mail:"
    String.raw`appl(y|ying|ications?)[^.]{0,100}e-?mail\s*[:\-]?\s*$`,
    // "… to our HR Administrator, Mrs Supit ("
    String.raw`(human resources|\bHR\b)[^.]{0,60}[(:,\-]?\s*$`,
  ].join("|"),
  "i",
);
const WEAK_CONTEXT = /apply|application|recruit|vacanc|career|join our team|employment|hiring/i;

export interface Candidate {
  email: string;
  kind: "hr" | "named";
  score: number;
  page: string;
  /** The words around it on the page, for a human to judge. */
  context: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** The part of a hostname that identifies the school's own domain: "ise.ac.th", "uisgz.org". */
export function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const second = parts[parts.length - 2] ?? "";
  const twoLevel = parts.length >= 3 && (second.length <= 3 || /^(ac|co|com|edu|org|gov|net|sch)$/.test(second));
  return parts.slice(twoLevel ? -3 : -2).join(".");
}

/** Does this address belong to the school's own web domain, or one clearly its group's? */
export function sameDomain(email: string, siteUrl: string): boolean {
  const mailHost = email.split("@")[1]?.toLowerCase() ?? "";
  let siteHost = "";
  try {
    siteHost = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const a = registrable(mailHost);
  const b = registrable(siteHost);
  if (a === b) return true;
  // "gapps.uwcsea.edu.sg" belongs to "uwcsea.edu.sg".
  return mailHost.endsWith("." + b) || siteHost.endsWith("." + a);
}

/** Every address on a page, from visible text, mailto links, Cloudflare and JSON-LD. */
export function addressesOn(html: string): string[] {
  const found = new Set<string>();
  const add = (e: string) => {
    const clean = e.replace(/^mailto:/i, "").split(/[?&]/)[0]!.trim();
    if (clean && !JUNK.test(clean) && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(clean)) found.add(clean.toLowerCase());
  };
  for (const m of html.matchAll(/mailto:([^"'\s>]+)/gi)) {
    try {
      add(decodeURIComponent(m[1]!));
    } catch {
      add(m[1]!);
    }
  }
  for (const e of decodeCloudflareEmails(html)) add(e);
  for (const e of jsonLdEmails(html)) add(e);
  for (const m of htmlToText(html).matchAll(EMAIL_RE)) add(m[0]);
  return [...found];
}

/** Score the addresses on one page. `onCareerPage` is whether the page itself is about jobs. */
export function candidatesFromPage(html: string, pageUrl: string, siteUrl: string, onCareerPage: boolean): Candidate[] {
  // A Cloudflare-hidden address is swapped into the text first, so the words around it survive.
  let readable = html;
  for (const m of html.matchAll(/<a[^>]*(?:data-cfemail="|email-protection#)([0-9a-f]{6,})[^>]*>[\s\S]*?<\/a>/gi)) {
    const decoded = decodeCloudflareEmails(m[0])[0];
    if (decoded) readable = readable.replace(m[0], ` ${decoded} `);
  }
  const text = htmlToText(readable).replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const out: Candidate[] = [];

  for (const email of addressesOn(html)) {
    const local = email.split("@")[0]!;
    const hrName = HR_LOCAL.test(local);
    if (NOT_HR.test(local) && !hrName) continue;

    const at = lower.indexOf(email);
    const before = at >= 0 ? text.slice(Math.max(0, at - 140), at) : "";
    const around = at >= 0 ? text.slice(Math.max(0, at - 140), at + email.length + 60) : "";
    const strong = STRONG_CONTEXT.test(before + " ");
    const weak = WEAK_CONTEXT.test(around);
    const own = sameDomain(email, siteUrl);

    let score = 0;
    if (hrName) score += 3;
    if (strong) score += 3;
    else if (weak) score += 1;
    if (onCareerPage) score += 1;
    if (!own) score -= hrName && onCareerPage ? 1 : 3;

    // An address named for hiring, on a careers page — or any address the
    // page explicitly tells you to send your application to.
    const accepted = (hrName && onCareerPage && score >= 4) || (strong && onCareerPage && own && score >= 4);
    if (!accepted) continue;
    out.push({ email, kind: hrName ? "hr" : "named", score, page: pageUrl, context: around.trim().slice(0, 220) });
  }
  return out;
}

const GUESS_PATHS = ["careers", "employment", "join-us", "jobs", "vacancies", "work-with-us"];

/** Links on a page that look like they lead to the careers page, best first. */
export function careerLinks(html: string, base: string): string[] {
  const scored = new Map<string, number>();
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>(?=([\s\S]{0,260}))/gi)) {
    const [, href, rest] = m;
    if (/^(mailto|tel|javascript):/i.test(href!)) continue;
    let abs: string;
    try {
      abs = new URL(href!, base).href;
    } catch {
      continue;
    }
    if (/\.(pdf|jpe?g|png|zip|docx?)(\?|$)/i.test(abs)) continue;
    const label = htmlToText((rest ?? "").split(/<\/a>/i)[0] ?? "").slice(0, 80);
    // "staff" and "teaching" alone list colleagues; only words about hiring count.
    const urlHit = STRONG_URL.test(abs);
    const wordHit = /\b(careers?|employment|vacanc\w*|work with us|work at|join (us|our)|jobs?|recruit\w*|opportunities)\b/i.test(label);
    if (!urlHit && !wordHit) continue;
    scored.set(abs, Math.max(scored.get(abs) ?? 0, (urlHit ? 2 : 0) + (wordHit ? 2 : 0)));
  }
  return [...scored]
    .sort((a, b) => b[1] - a[1])
    .map(([u]) => u)
    .slice(0, 5);
}

/** Every link on a page with its words, for finding a form to download. */
export function pageLinks(html: string, base: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>(?=([\s\S]{0,200}))/gi)) {
    if (/^(mailto|tel|javascript):/i.test(m[1]!)) continue;
    try {
      out.push({ url: new URL(m[1]!, base).href, text: htmlToText((m[2] ?? "").split(/<\/a>/i)[0] ?? "").slice(0, 100) });
    } catch {
      /* not a link */
    }
  }
  return out;
}

/** Words that make a link the form itself, not a page about applying. */
const APPLICATION_FORM_WORDS = /\b(application\s+form|form\s+of\s+application|application\s+for\s+employment|employment\s+application|staff\s+application|teacher\s+application|job\s+application\s+form|candidate\s+(application|details)\s+form)\b/i;
const NOT_FORM_WORDS = /\b(admission|admissions|enrol|enrolment|enrollment|student|students|pupil|scholarship|parent|parents|visit|tour|summer|camp|holiday|club|clubs|trial|non[\s-]?teaching|support[\s-]+staff|waitlist|sign[_\s-]?in|register\s+your\s+child)\b/i;
/** Student-admissions platforms: whatever their link says, the form is for a family. */
const STUDENT_PLATFORM = /openapply|fsenrollment|ravenna|veracross|schoolmint|sycamore|isams|gradelink|enrolmy|admissionsplus|myschoolapp/i;

/** A hosted form service: the link itself is the form. */
const FORM_SERVICE = /docs\.google\.com\/(forms|document)|forms\.gle|forms\.office\.com|sharepoint\.com|jotform|typeform|tally\.so|formstack|wufoo|airtable|smartsheet|fillout/i;
/** Words that put a plain page of a school's own site on the staff side. */
const STAFF_WORDS = /staff|teacher|teaching|employ|job|career|recruit|vacanc|faculty|educator|applicant|candidate|work/i;

/** An application form linked from a careers page: a file to fill in, or an online form. */
export function formOnPage(html: string, pageUrl: string): (ApplicationForm & { page: string }) | undefined {
  // Forms for students and parents are not what a teacher fills in.
  const links = pageLinks(html, pageUrl).filter((l) => !NOT_FORM_WORDS.test(`${l.text} ${l.url}`) && !STUDENT_PLATFORM.test(l.url));
  const found = detectApplicationForm({ links });
  // Only a form with an address to open counts: "a form exists somewhere" cannot be clicked.
  // A plain page of the school's own site called "application form" is usually for families unless it says staff.
  const isStaffy = (url: string, words?: string) => FORM_SERVICE.test(url) || /\.(pdf|docx?|odt|rtf)(\?|$)/i.test(url) || STAFF_WORDS.test(`${url} ${words ?? ""}`);
  if (found.kind !== "none" && found.url && isStaffy(found.url, found.evidence)) return { ...found, page: pageUrl };

  // A link worded as the form itself, even where the address has no file extension
  // (a Drive file, a download script, a Google Doc).
  for (const l of links) {
    if (!APPLICATION_FORM_WORDS.test(l.text) || NOT_FORM_WORDS.test(l.text)) continue;
    if (!(FORM_SERVICE.test(l.url) || /\.(pdf|docx?|odt|rtf)(\?|$)/i.test(l.url) || STAFF_WORDS.test(`${l.url} ${l.text}`))) continue;
    const kind: ApplicationForm["kind"] = /\.docx?(\?|$)|\.odt(\?|$)|\.rtf(\?|$)|\/document\//i.test(l.url) ? "word" : /\.pdf(\?|$)/i.test(l.url) ? "pdf" : "online";
    return { kind, url: l.url, evidence: l.text, page: pageUrl };
  }
  return undefined;
}

export interface ScanResult {
  best?: Candidate;
  others: Candidate[];
  pagesRead: number;
  /** The school's application form, when its careers pages link one. */
  form?: ApplicationForm & { page: string };
  /** Every address seen on the pages read, hiring or not. All of them are kept. */
  addresses: string[];
}

export async function scanSchool(site: string): Promise<ScanResult> {
  const opts = { soft: true, retries: 0, timeoutMs: 15000, fresh: true } as const;
  const pages: { url: string; html: string; career: boolean }[] = [];

  const home = await fetchText(site, { ...opts, label: `hr-scan ${site}` });
  if (home) {
    pages.push({ url: site, html: home, career: STRONG_URL.test(site) });
    for (const link of careerLinks(home, site)) {
      const html = await fetchText(link, { ...opts, label: `hr-scan ${link}` });
      if (html) pages.push({ url: link, html, career: true });
    }
  }

  // A site whose menu is built by script shows no links; try the usual addresses.
  if (!pages.slice(1).some((p) => STRONG_URL.test(p.url))) {
    let origin = "";
    try {
      origin = new URL(site).origin;
    } catch {
      return { others: [], pagesRead: pages.length, addresses: [] };
    }
    const dir = site.endsWith("/") ? site : site + "/";
    for (const p of GUESS_PATHS) {
      const url = `${dir}${p}`;
      if (pages.some((x) => x.url === url)) continue;
      const html = await fetchText(url, { ...opts, label: `hr-scan ${url}` });
      if (html) pages.push({ url, html, career: true });
    }
  }

  const byEmail = new Map<string, Candidate>();
  for (const p of pages) {
    for (const c of candidatesFromPage(p.html, p.url, site, p.career)) {
      const prev = byEmail.get(c.email);
      if (!prev || c.score > prev.score) byEmail.set(c.email, c);
    }
  }
  // Downloadable files beat online forms, and a form on a careers page beats one on the homepage.
  // A form on the homepage is as likely to be for families as for staff, so only careers pages count.
  const forms = pages.filter((p) => p.career).map((p) => ({ f: formOnPage(p.html, p.url), career: true })).filter((x) => x.f);
  const rank = (x: (typeof forms)[number]) => (x.f!.kind === "online" ? 0 : 2) + (x.career ? 1 : 0);
  const form = forms.sort((a, b) => rank(b) - rank(a))[0]?.f;

  const ranked = [...byEmail.values()].sort((a, b) => b.score - a.score || (a.kind === "hr" ? -1 : 1));
  const addresses = [...new Set(pages.flatMap((p) => addressesOn(p.html)))];
  return { best: ranked[0], others: ranked.slice(1), pagesRead: pages.length, form, addresses };
}
