/**
 * Finding and ranking school email addresses.
 *
 * The goal is the single best address to send a PE application to. Schools
 * publish these inconsistently — sometimes a tidy `recruitment@`, often only a
 * generic `info@`, and quite often only inside a job-pack PDF. We collect every
 * candidate, classify it, and let the caller take the top-scoring one.
 */

import type { DiscoveredEmail, EmailKind } from "../core/types.ts";

/**
 * Deliberately conservative: requires a dot-separated TLD of 2+ letters and
 * disallows the trailing punctuation that HTML and PDFs leave attached.
 */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g;

/** Obfuscations schools use to dodge naive scrapers. */
const DEOBFUSCATE: [RegExp, string][] = [
  [/\s*\(\s*at\s*\)\s*/gi, "@"],
  [/\s*\[\s*at\s*\]\s*/gi, "@"],
  [/\s+at\s+(?=[A-Za-z0-9.-]+\s*(?:\(|\[)?\s*dot)/gi, "@"],
  [/\s*\(\s*dot\s*\)\s*/gi, "."],
  [/\s*\[\s*dot\s*\]\s*/gi, "."],
  [/\s+dot\s+/gi, "."],
  [/\s*&#64;\s*/g, "@"],
  [/\s*%40\s*/gi, "@"],
];

/** Addresses that are never a real contact for a job application. */
const JUNK =
  /^(?:no-?reply|do-?not-?reply|postmaster|abuse|webmaster|hostmaster|mailer-daemon|privacy|unsubscribe|support@(?:wix|squarespace|wordpress|godaddy))/i;

/**
 * "Careers" at a school means two opposite things. A careers counsellor,
 * adviser or guidance lead helps pupils choose universities; writing to them
 * about a teaching post reaches the wrong person entirely.
 */
const STUDENT_CAREERS_ADDRESS =
  /(?:career|careers)[._-]?(?:counsell?or|counsel|advis[eo]r|advice|guidance|service|centre|center|office|dept|department|lead|coordinator|co-?ordinator)|(?:university|uni|college|higher[._-]?ed)[._-]?(?:guidance|advis|counsell?)|(?:orientaci[oó]n|consejer[ií]a)[._-]?(?:vocacional|universitaria|estudiantil)?|orientador(?:a)?[._-]?vocacional/i;

const JUNK_DOMAIN =
  /(?:\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.css|\.js|sentry\.io|example\.(?:com|org)|domain\.com|yourschool|wixpress\.com|squarespace\.com|schooljotter|sentry-next)/i;

/**
 * Local-part patterns, most specific first. Score is the base confidence that
 * this address is the right destination for a teaching application.
 */
const KIND_RULES: { re: RegExp; kind: EmailKind; score: number }[] = [
  { re: /^(?:recruit|recruitment|recruiting|hiring|vacancy|vacancies|jobs?|career|careers|employment|apply|application|applications|joinus|join|work(?:withus|foru?s)?|teach(?:withus)?|staffing|talent)/i, kind: "careers", score: 0.97 },
  /*
   * The same thing in the languages these schools actually write in.
   *
   * Found the hard way: the American School of Quito publishes
   * rrhh@fcaq.k12.ec — Recursos Humanos, exactly the address to write to — and
   * it was filed as "other" because the rules only spoke English. Eight of the
   * configured countries are Spanish-speaking, and the same gap covers
   * Portuguese, Indonesian, Turkish and the rest.
   */
  { re: /^(?:empleos?|trabaj[ao]|trabajaconnosotros|vacantes?|convocatorias?|postulaci[oó]n|selecci[oó]n(?:depersonal)?|reclutamiento|talentohumano)/i, kind: "careers", score: 0.95 },
  { re: /^(?:vagas?|trabalhec?o?n?o?s?c?o?|carreiras?|curriculos?|candidaturas?)/i, kind: "careers", score: 0.95 },
  { re: /^(?:emplois?|recrutement|carri[eè]res?|candidatures?)/i, kind: "careers", score: 0.95 },
  { re: /^(?:karie?r|rekrutmen|lowongan|kerjaya|jawatan|pekerjaan)/i, kind: "careers", score: 0.95 },
  { re: /^(?:kariyer|basvuru|ba[sş]vuru|i[sş]ealim)/i, kind: "careers", score: 0.95 },
  { re: /^(?:zhaopin|zhao-pin|saiyou?|jinji|chaeyong|insa)/i, kind: "careers", score: 0.9 },
  // Human Resources, abbreviated. Short forms must be the whole local part or
  // clearly delimited — a bare "rh" inside a surname is not an HR desk.
  { re: /^(?:rrhh|recursoshumanos|recursos\.humanos|risorseumane|personalabteilung|insankaynaklari)(?:$|[._-])/i, kind: "hr", score: 0.94 },
  { re: /^(?:rh|drh|ik)(?:$|[._-])/i, kind: "hr", score: 0.85 },
  { re: /^(?:hr|humanresources|human\.resources|people|peopleteam|personnel|hrdept|hr\.dept|hrteam)/i, kind: "hr", score: 0.92 },
  { re: /(?:recruit|vacanc|career|hiring|employment)/i, kind: "careers", score: 0.88 },
  { re: /^(?:hr|people|personnel)[._-]/i, kind: "hr", score: 0.85 },
  { re: /(?:^|[._-])hr(?:$|[._-])/i, kind: "hr", score: 0.8 },
  { re: /^(?:principal|headteacher|head\.teacher|headmaster|headmistress|director|superintendent|ceo)/i, kind: "principal", score: 0.6 },
  { re: /^(?:admin|administration|office|reception|secretary|enquir|enquiries|inquiry|contact|school)/i, kind: "admin", score: 0.45 },
  { re: /^(?:info|information|hello|mail|general)/i, kind: "info", score: 0.4 },
];

/** Page/file paths that make any email found there more likely to be the one. */
const CAREERS_CONTEXT = /(?:career|vacanc|recruit|job|employment|work-with|join-us|hiring|staff-openings|opportunit)/i;

export function classifyEmail(email: string, foundAt: string, via: string): DiscoveredEmail {
  const local = email.split("@")[0] ?? "";
  let kind: EmailKind = "other";
  let score = 0.25;

  for (const rule of KIND_RULES) {
    if (rule.re.test(local)) {
      kind = rule.kind;
      score = rule.score;
      break;
    }
  }

  // An address published on a careers page is more likely the right one even
  // when its local part is generic.
  if (CAREERS_CONTEXT.test(foundAt)) {
    score = Math.min(0.99, score + 0.18);
    if (kind === "other" || kind === "info" || kind === "admin") {
      score = Math.min(0.99, score + 0.05);
    }
  }
  // Job-pack PDFs almost always print the address you should actually use.
  if (via === "pdf") score = Math.min(0.99, score + 0.08);
  // A named individual's address is a weaker generic target.
  if (/^[a-z]+[._][a-z]+$/i.test(local) && kind === "other") score = 0.3;

  return { email: email.toLowerCase(), kind, score, foundAt, via };
}

/** Pull every plausible address out of a blob of text. */
export function extractEmails(text: string, foundAt: string, via: string): DiscoveredEmail[] {
  if (!text) return [];

  let normalised = text;
  for (const [re, to] of DEOBFUSCATE) normalised = normalised.replace(re, to);

  const seen = new Map<string, DiscoveredEmail>();
  for (const match of normalised.matchAll(EMAIL_RE)) {
    const raw = match[0];
    // Strip a trailing dot that the regex can pick up from prose.
    const email = raw.replace(/\.$/, "").toLowerCase();
    const local = email.split("@")[0] ?? "";
    const domain = email.split("@")[1] ?? "";

    if (JUNK.test(local) || JUNK_DOMAIN.test(email) || JUNK_DOMAIN.test(domain)) continue;
    // A student careers adviser is the wrong person for a teaching application.
    if (STUDENT_CAREERS_ADDRESS.test(local)) continue;
    // Filenames like `logo@2x.png` and version strings slip through otherwise.
    if (/^\d+x$/i.test(local) || domain.split(".").some((p) => !p)) continue;
    if (email.length > 120) continue;

    const found = classifyEmail(email, foundAt, via);
    const prev = seen.get(email);
    if (!prev || found.score > prev.score) seen.set(email, found);
  }
  return [...seen.values()];
}

/** Merge candidate lists, keeping the best-scoring instance of each address. */
export function mergeEmails(...lists: DiscoveredEmail[][]): DiscoveredEmail[] {
  const best = new Map<string, DiscoveredEmail>();
  for (const list of lists) {
    for (const e of list) {
      const prev = best.get(e.email);
      if (!prev || e.score > prev.score) best.set(e.email, e);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * The address to put in the "career email" column: the best careers/HR match.
 * Falls back to nothing rather than guessing a generic inbox — the separate
 * "school email" column already carries that.
 */
export function bestCareerEmail(emails: DiscoveredEmail[], schoolDomain?: string): DiscoveredEmail | undefined {
  const ranked = [...emails].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));
  const onDomain = (e: DiscoveredEmail) =>
    !schoolDomain || e.email.endsWith("@" + schoolDomain) || e.email.includes(schoolDomain);

  return (
    ranked.find((e) => (e.kind === "careers" || e.kind === "hr") && onDomain(e)) ??
    ranked.find((e) => e.kind === "careers" || e.kind === "hr")
  );
}

/** The general-purpose school inbox for the "school email" column. */
export function bestSchoolEmail(emails: DiscoveredEmail[], schoolDomain?: string): DiscoveredEmail | undefined {
  const ranked = [...emails].sort((a, b) => b.score - a.score);
  const onDomain = (e: DiscoveredEmail) =>
    !schoolDomain || e.email.endsWith("@" + schoolDomain) || e.email.includes(schoolDomain);
  const order: EmailKind[] = ["info", "admin", "principal", "careers", "hr", "other"];

  for (const kind of order) {
    const hit = ranked.find((e) => e.kind === kind && onDomain(e));
    if (hit) return hit;
  }
  return ranked.find(onDomain) ?? ranked[0];
}

/** Domain of a school website, for preferring same-domain addresses. */
export function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
