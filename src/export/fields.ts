/**
 * The column registry — the "tick list".
 *
 * Every column the exporter can produce is declared here once, with the header
 * text used in the Google Sheet and a getter that reads from a job row, a
 * school row, or both. `config/fields.json` decides which ones are on.
 *
 * Adding a column means adding one entry here; nothing else changes.
 */

import {
  hiringHistory,
  openRolesBySchool,
  parseJsonColumn,
  type HiringHistory,
  type OpenRoles,
  type JobRow,
  type SchoolRow,
} from "../store/db.ts";
import { countryName, truncate } from "../core/text.ts";
import type { ApplicationForm, DiscoveredEmail, Salary } from "../core/types.ts";
import { formLabel } from "../match/appform.ts";
import {
  draftEmail,
  emailCell,
  loadProfile,
  resetProfile,
  schoolFact,
  speculativeEmail,
} from "./email.ts";
import { assessFit, fitSummary } from "../match/fit.ts";
import { BASIS_LABEL } from "../enrich/salary.ts";
import { benchmarkAverage, benchmarkSavings, countryBenchmark } from "../enrich/benchmarks.ts";
import { RANK_BASIS_LABEL } from "../match/packagevalue.ts";
import { STATUS_LABEL as MY_STATUS_LABEL } from "../track.ts";

export interface FieldContext {
  job?: JobRow;
  school?: SchoolRow;
}

export interface FieldDef {
  key: string;
  /** Column header written to the sheet. */
  label: string;
  /** Grouping for `fields --list`. */
  group: "location" | "school" | "package" | "contact" | "job" | "tracking";
  /** Which export shapes this column makes sense in. */
  scope: "job" | "school" | "both";
  /** Shown in `fields --list` to explain the column. */
  help: string;
  get(ctx: FieldContext): string;
}

const SENIORITY_LABELS: Record<string, string> = {
  director_of_sport: "Director of Sport",
  head_of_department: "Head of Department",
  second_in_department: "2nd in Department",
  coordinator: "Coordinator",
  teacher: "Teacher",
  coach: "Coach",
  support: "Support",
  unknown: "Unknown",
};

const SOURCE_LABELS: Record<string, string> = {
  tes: "TES",
  teachaway: "Teach Away",
  teacherhorizons: "Teacher Horizons",
  nordanglia: "Nord Anglia",
  inspired: "Inspired Education",
  schoolsite: "School website",
  mailalert: "Email alert",
  europeanchamber: "European Chamber",
  isp: "Intl Schools Partnership",
};

const PHASE_LABELS: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  k12: "Primary + Secondary",
  university: "University",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  stale: "Possibly filled",
  closed: "Closed",
};

function formatSalary(s: Salary | null | undefined): string {
  if (!s) return "";
  if (s.min == null && s.max == null) return s.text ?? "";
  const cur = s.currency ? s.currency + " " : "";
  const n = (v: number) => v.toLocaleString("en-GB");
  const range = s.min != null && s.max != null && s.min !== s.max
    ? `${n(s.min)}–${n(s.max)}`
    : n((s.min ?? s.max)!);
  const period = s.period
    ? "/" + s.period.toLowerCase().replace("ly", "").replace("annual", "year").replace("month", "month")
    : "";
  return `${cur}${range}${period}`.trim();
}

/**
 * Join a list into one cell. Bullets and hard line breaks come straight from
 * advert HTML and make a spreadsheet row unreadable, so they are flattened to
 * a single separated line.
 */
function list(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .filter(Boolean)
    .map((item) =>
      String(item)
        .replace(/[•·▪]/g, " ")
        .replace(/\s*\r?\n\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("; ");
}

/** Whole days from now until an ISO date; negative once it has passed. */
export function daysUntil(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function date(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  // Sheets parses YYYY-MM-DD as a date; a full ISO timestamp it treats as text.
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Hiring history, loaded once per process.
 *
 * The CLI is short-lived, so a single read is always current. `resetHiring`
 * exists for the watch loop, which stays up across runs.
 */
let hiringCache: Map<string, HiringHistory> | null = null;
const hiringFor = (key?: string | null): HiringHistory | undefined => {
  hiringCache ??= hiringHistory();
  return key ? hiringCache.get(key) : undefined;
};
/** Vacancies open right now, cached on the same terms as the hiring history. */
let openRolesCache: Map<string, OpenRoles> | null = null;
const openRolesFor = (key?: string | null): OpenRoles | undefined => {
  openRolesCache ??= openRolesBySchool();
  return key ? openRolesCache.get(key) : undefined;
};

export const resetHiring = (): void => {
  hiringCache = null;
  openRolesCache = null;
};

/**
 * Before this much observation, how often a school advertises says nothing —
 * one posting in a fortnight is not a pattern. The column stays blank until
 * the database has watched long enough to be worth reading.
 */
const MIN_MONTHS_TO_JUDGE = 6;

/**
 * Turn postings-per-year into a plain word.
 *
 * Deliberately coarse: this is a hint to look closer at a school, not a
 * measurement. A single PE department rarely needs more than one new teacher a
 * year unless people are leaving.
 */
export function turnoverLabel(h: HiringHistory | undefined): string {
  if (!h) return "";

  /*
   * Say when the verdict arrives, rather than nothing at all.
   *
   * The column read blank for every school and looked broken. It is not: one
   * posting in a fortnight is not a pattern, and calling it "High" would be
   * guesswork about the thing that matters most — whether people leave. So
   * until there is enough history the cell reports its own progress, which is
   * both honest and a reason to keep the database running.
   */
  if (h.monthsObserved < MIN_MONTHS_TO_JUDGE) {
    const left = Math.max(1, Math.ceil(MIN_MONTHS_TO_JUDGE - h.monthsObserved));
    return `watching — ${h.postings} advert${h.postings === 1 ? "" : "s"} so far, ${left}mo to a verdict`;
  }

  const perYear = h.postings / (h.monthsObserved / 12);
  if (perYear >= 3) return "High";
  if (perYear >= 1.5) return "Moderate";
  return "Low";
}

/**
 * How long is left to apply, written the way you would say it.
 *
 * A bare date makes you do the arithmetic, and a bare number of days makes you
 * look up the date. This gives both, and leads with whichever matters: a
 * closing date three weeks out is a date, one closing tomorrow is a warning.
 *
 * The blank case is the common one and the most easily misread. About half of
 * adverts publish no closing date at all, and that does not mean there is
 * time — international schools tend to close a post as soon as they have the
 * right person, so no date means apply sooner, not later. The cell says that
 * rather than leaving an empty square that reads as "no rush".
 */
export function lastDay(deadline: string | null | undefined, hasVacancy = false): string {
  if (!deadline) {
    // No vacancy is nothing to say. A vacancy with no published date is the
    // opposite of nothing to say, and an empty cell would read as "no rush".
    return hasVacancy ? "not stated — these close once filled" : "";
  }

  const when = new Date(deadline);
  if (Number.isNaN(when.getTime())) return "";
  const on = when.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  /*
   * Calendar days, not elapsed hours divided by 24.
   *
   * `daysUntil` measures the gap in milliseconds, so a deadline at noon today
   * comes back as 1 and "TODAY" could never fire. A closing date is a date:
   * applications are open during it, and what a reader wants to know is how
   * many more dates they have — which is a difference between midnights.
   */
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(when) - midnight(new Date())) / 86_400_000);

  if (days < 0) return `closed ${on}`;
  if (days === 0) return `TODAY — ${on}`;
  if (days === 1) return `TOMORROW — ${on}`;
  if (days <= 7) return `${days} days — ${on}`;
  return `${on} (${days} days)`;
}

/**
 * Where teachers talk about schools. Searched by you, never by the scraper.
 *
 * Reddit's robots.txt is `Disallow: /` and International Schools Review is
 * subscription-only, so neither can be collected automatically. That does not
 * make what they contain worthless — staff reviews are the one thing no
 * directory publishes, and they are where you learn a school is a bad place to
 * work. So the sheet carries the search, not the answer.
 */
const FORUM_SITES = [
  "reddit.com/r/internationalteachers",
  "internationalschoolsreview.com",
  "tes.com/jobs",
];

export function reputationSearch(school: string | null | undefined): string {
  const name = school?.trim();
  if (!name) return "";
  const sites = FORUM_SITES.map((s) => `site:${s}`).join(" OR ");
  return `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" (${sites})`)}`;
}

/**
 * The best way to reach this school, whatever that turns out to be.
 *
 * A careers address is what you want, and a bit over a quarter of schools have
 * one. The rest are not unreachable — most have a general inbox, a switchboard
 * number, or at least a Facebook page — but that was spread across four
 * columns, so a row with no careers address read as a dead end when it was
 * not. This resolves the whole ladder into one cell, and names what it found,
 * because writing to a general inbox needs a different opening line than
 * writing to HR.
 */
export function bestContact(c: FieldContext): { value: string; kind: string } {
  const s = c.school;
  if (s?.career_email) return { value: s.career_email, kind: "careers address" };
  if (s?.school_email) return { value: s.school_email, kind: "general inbox" };

  // Anything the crawl found but did not rank highly enough to promote. A
  // named teacher's address still reaches a human at the school.
  const any = parseJsonColumn<DiscoveredEmail[]>(s?.emails_json ?? null, [])
    .sort((a, b) => b.score - a.score)[0];
  if (any) return { value: any.email, kind: `${any.kind} address` };

  const fromJob = parseJsonColumn<string[]>(c.job?.emails_json ?? null, [])[0];
  if (fromJob) return { value: fromJob, kind: "from the advert" };

  if (s?.phone) return { value: s.phone, kind: "phone — no email published" };
  // Last resort, and the reason the social column exists: the scraper cannot
  // read these pages, but you can, and the About section usually has an address.
  if (s?.social) return { value: s.social, kind: "social page — look it up yourself" };

  return { value: "", kind: "" };
}

/** School columns fall back to the job row when a school has not been enriched. */
const schoolCountry = (c: FieldContext): string =>
  countryName(c.school?.country ?? c.job?.country ?? undefined) ?? "";

export const FIELDS: FieldDef[] = [
  // ---- location -------------------------------------------------------
  {
    key: "country", label: "Country", group: "location", scope: "both",
    help: "Country the school is in.",
    get: schoolCountry,
  },
  {
    key: "city", label: "City", group: "location", scope: "both",
    help: "City or emirate.",
    get: (c) => c.school?.city ?? c.job?.city ?? "",
  },

  // ---- school ---------------------------------------------------------
  {
    key: "school_name", label: "School Name", group: "school", scope: "both",
    help: "Name of the school.",
    get: (c) => c.school?.name ?? c.job?.school_name ?? "",
  },
  {
    key: "curriculum", label: "Curriculum", group: "school", scope: "both",
    help: "IB / IGCSE / Cambridge / British / American etc.",
    get: (c) =>
      list(parseJsonColumn<string[]>(c.school?.curriculum_json ?? null, [])) ||
      list(parseJsonColumn<string[]>(c.job?.curriculum_json ?? null, [])),
  },
  {
    key: "pe_team_size", label: "PE Team (teachers)", group: "school", scope: "both",
    help: "Number of PE teaching staff. Estimated from the school website — check the confidence column.",
    get: (c) => (c.school?.pe_team_size != null ? String(c.school.pe_team_size) : ""),
  },
  {
    key: "student_count", label: "Students in School", group: "school", scope: "both",
    help: "Total roll, read from the school's own website.",
    get: (c) => (c.school?.student_count != null ? String(c.school.student_count) : ""),
  },
  {
    key: "school_type", label: "School Type", group: "school", scope: "both",
    help: "Primary, Secondary, Primary + Secondary, or University.",
    get: (c) => PHASE_LABELS[c.school?.school_type ?? ""] ?? "",
  },
  {
    key: "website", label: "Website", group: "school", scope: "both",
    help: "School website.",
    get: (c) => c.school?.website ?? c.job?.school_website ?? "",
  },
  {
    key: "best_contact", label: "Best Contact", group: "contact", scope: "both",
    help: "The single best way to reach this school, whatever that turns out to be: the careers address, else HR, else the general inbox, else any address found at all, else the phone, else the Facebook page. Read it with Contact Type beside it — a switchboard number is not a careers desk.",
    get: (c) => bestContact(c).value,
  },
  {
    key: "contact_type", label: "Contact Type", group: "contact", scope: "both",
    help: "What the Best Contact actually is, so a general inbox is never mistaken for a recruitment address.",
    get: (c) => bestContact(c).kind,
  },
  {
    key: "speculative_email", label: "Speculative Letter", group: "contact", scope: "school",
    help: "A letter to a school that is not advertising — most international appointments are made before a vacancy is published, which is what this whole list is for. Built only from facts held about the school; where there are none it says so rather than sending a form letter.",
    get: (c) => {
      const s = c.school;
      if (!s) return "";
      const draft = speculativeEmail({
        school: s.name,
        principal: s.principal,
        schoolHook: s.school_hook,
        peHook: s.pe_hook,
        accreditation: s.accreditation,
        curriculum: parseJsonColumn<string[]>(s.curriculum_json, []),
        studentCount: s.student_count,
      });
      return emailCell(draft, s.website ?? s.social);
    },
  },
  {
    key: "outreach_ready", label: "Ready to Write?", group: "contact", scope: "school",
    help: "Whether this school can be approached today: a route to reach them and something true to say. Sort on it to work down the list.",
    get: (c) => {
      const s = c.school;
      if (!s) return "";
      const reachable = !!bestContact(c).value;
      const hasFact = !!schoolFact({
        school: s.name,
        schoolHook: s.school_hook,
        accreditation: s.accreditation,
        curriculum: parseJsonColumn<string[]>(s.curriculum_json, []),
        studentCount: s.student_count,
      });
      if (reachable && hasFact) return "Yes — write today";
      if (!reachable && !hasFact) return "No — no contact, nothing to say";
      return reachable ? "Need a fact about them" : "Need a contact";
    },
  },
  {
    key: "reputation", label: "What Teachers Say", group: "school", scope: "both",
    help: "A prepared search across the teacher forums for this school. The scraper cannot read Reddit or ISR — both forbid automated collection — but you can, and what current staff say about a school is the one thing no directory will tell you. Open it before you apply.",
    get: (c) => reputationSearch(c.school?.name ?? c.job?.school_name),
  },
  {
    key: "phone", label: "Phone", group: "contact", scope: "both",
    help: "Switchboard number as the directory publishes it. The route left when a school has no email and no website — for a shortlisted school it is often faster than either.",
    get: (c) => c.school?.phone ?? "",
  },
  {
    key: "social", label: "Facebook / Instagram", group: "school", scope: "both",
    help: "The school's social page. For a school with no website this is the only route left — open it yourself and read the About section for the head's name and a contact address. The scraper never reads these: Meta's terms forbid automated collection.",
    get: (c) => c.school?.social ?? "",
  },
  {
    key: "pe_roles_seen", label: "PE Roles Seen", group: "school", scope: "both",
    help: "How many separate PE vacancies this school has advertised since the scraper started watching. Repeated adverts hint at people not staying.",
    get: (c) => {
      const h = hiringFor(c.school?.school_key ?? c.job?.school_key);
      return h ? String(h.postings) : "";
    },
  },
  {
    key: "hiring_now", label: "Open PE Role?", group: "school", scope: "school",
    help: "Whether this school has a PE vacancy open right now. A school earns its place in the list on its own merits, not on whether it happens to be advertising — this column is when to act, not why it is listed.",
    get: (c) => {
      const o = openRolesFor(c.school?.school_key);
      if (!o) return "No";
      return o.count === 1 ? `Yes — ${o.titles[0]}` : `Yes — ${o.count} roles`;
    },
  },
  {
    key: "hiring_now_link", label: "Open Role Link", group: "school", scope: "school",
    help: "The vacancy behind the Open PE Role? column. Blank when the school is not advertising.",
    get: (c) => openRolesFor(c.school?.school_key)?.url ?? "",
  },
  {
    key: "last_day", label: "Last Day", group: "job", scope: "both",
    help: "The last day to apply, in plain words. On the schools list it is the soonest closing date among that school's open roles. Where no date is published it says so — half of adverts give none, and international schools usually close a post once they have the right person, so silence means apply sooner rather than later.",
    get: (c) => {
      // A job row always has a vacancy; a school row only when one is open.
      const open = c.job ? undefined : openRolesFor(c.school?.school_key);
      return lastDay(c.job?.deadline_at ?? open?.deadline, !!c.job || !!open);
    },
  },
  {
    key: "hiring_now_deadline", label: "Open Role Deadline", group: "school", scope: "school",
    help: "Soonest closing date among this school's open PE roles, so an urgent one is visible from the schools list.",
    get: (c) => date(openRolesFor(c.school?.school_key)?.deadline),
  },
  {
    key: "draft_email", label: "Prepared Email", group: "contact", scope: "job",
    help: "A personalised application email, built only from details found on the school's own website. When a detail is missing it says which one, rather than inventing it.",
    get: (c) => {
      if (!c.job) return "";
      return emailCell(
        draftEmail({
          role: c.job.title,
          school: c.school?.name ?? c.job.school_name ?? "",
          principal: c.school?.principal,
          schoolHook: c.school?.school_hook,
          peHook: c.school?.pe_hook,
          advertText: c.job.description,
        }),
        // The website is where every missing detail lives, so an incomplete
        // draft points straight at it. Where there is no website, the school's
        // social page is the only route left, so send the reader there instead.
        c.school?.website ?? c.job.school_website ?? c.school?.social,
      );
    },
  },
  {
    key: "fit", label: "Fit", group: "job", scope: "job",
    help: "What this advert asks for that you can evidence, from config/profile.json. Only requirements the advert actually states are counted.",
    get: (c) => {
      const p = loadProfile();
      if (!c.job?.description || !p?.qualifications?.length) return "";
      return fitSummary(assessFit(c.job.description, p.qualifications));
    },
  },
  {
    key: "fit_score", label: "Fit %", group: "job", scope: "job",
    help: "Share of the advert's stated requirements you can evidence. Sort by it to find the roles you are strongest for.",
    get: (c) => {
      const p = loadProfile();
      if (!c.job?.description || !p?.qualifications?.length) return "";
      const f = assessFit(c.job.description, p.qualifications);
      return f.signals.length + f.gaps.length === 0 ? "" : String(f.score);
    },
  },
  {
    key: "fit_gaps", label: "They Also Want", group: "job", scope: "job",
    help: "Requirements the advert states that your profile does not claim — worth knowing before you apply.",
    get: (c) => {
      const p = loadProfile();
      if (!c.job?.description || !p?.qualifications?.length) return "";
      return assessFit(c.job.description, p.qualifications).gaps.join(" · ");
    },
  },
  {
    key: "principal", label: "Principal", group: "contact", scope: "both",
    help: "Head of School, read from the school's own site. Blank when it could not be established with confidence.",
    get: (c) => c.school?.principal ?? "",
  },
  {
    key: "turnover", label: "Turnover", group: "school", scope: "both",
    help: "Low / Moderate / High, from how often the school advertises PE roles. Blank until the database has watched for six months — before that it would be guesswork.",
    get: (c) => turnoverLabel(hiringFor(c.school?.school_key ?? c.job?.school_key)),
  },

  // ---- package --------------------------------------------------------
  {
    key: "fees", label: "Yearly Fees", group: "package", scope: "both",
    help: "Published tuition, from the International Schools Database. Not a salary — but it is the only per-school money signal that exists, and a school charging three times its neighbour is not paying its teachers the same. A country salary average cannot tell schools apart; this can.",
    get: (c) => {
      const s = c.school;
      if (!s?.fee_low && !s?.fee_high) return "";
      const n = (v: number | null) => (v == null ? "?" : v.toLocaleString("en-GB"));
      const cur = s.fee_currency ? s.fee_currency + " " : "";
      return s.fee_low && s.fee_high ? `${cur}${n(s.fee_low)}–${n(s.fee_high)}` : `${cur}${n(s.fee_high ?? s.fee_low)}`;
    },
  },
  {
    key: "salary_estimate", label: "Approx. Salary (PE expat)", group: "package", scope: "both",
    help: "What this school pays, when it or its adverts say so. Otherwise the country average — always read the Salary Basis column beside it.",
    get: (c) => {
      const own =
        formatSalary(parseJsonColumn<Salary | null>(c.school?.salary_json ?? null, null)) ||
        formatSalary(parseJsonColumn<Salary | null>(c.job?.salary_json ?? null, null));
      if (own) return own;
      // Nobody publishes this school's pay. The country average is what is
      // actually knowable, and the basis column says that is what it is.
      const avg = benchmarkAverage(c.school?.country ?? c.job?.country);
      return avg ? `~USD ${avg.toLocaleString("en-GB")}/year` : "";
    },
  },
  {
    key: "salary_basis", label: "Salary Basis", group: "package", scope: "both",
    help: "Exactly what the salary figure is — this advert, the job pack, an average of this school's adverts, or the country average. A number without a basis should not be trusted.",
    get: (c) => {
      const stored = BASIS_LABEL[(c.school?.salary_basis ?? "") as keyof typeof BASIS_LABEL];
      const hasOwn =
        !!parseJsonColumn<Salary | null>(c.school?.salary_json ?? null, null) ||
        !!parseJsonColumn<Salary | null>(c.job?.salary_json ?? null, null);
      if (hasOwn && stored) return stored;
      const hit = countryBenchmark(c.school?.country ?? c.job?.country);
      if (!hit) return stored ?? "";
      // The sample travels with the figure: five submissions and five hundred
      // should not read the same, and a figure with no pool behind it should
      // not pretend to have one.
      return hit.reports
        ? `${BASIS_LABEL["country-benchmark"]} (${hit.reports} reports)`
        : `country figure — ${hit.source}`;
    },
  },
  {
    key: "savings", label: "Typical Savings/year", group: "package", scope: "both",
    help: "What teachers there actually keep after rent and tax. Usually the more useful number: Bangkok on $38k out-saves Singapore on $55k, because Singapore rent eats the difference.",
    get: (c) => {
      const s = benchmarkSavings(c.school?.country ?? c.job?.country);
      if (!s) return "";
      const n = (v: number) => (v / 1000).toFixed(0);
      return `USD ${n(s[0])}k–${n(s[1])}k`;
    },
  },
  {
    key: "salary_crosscheck", label: "Salary Cross-check", group: "package", scope: "both",
    help: "An independent source's figure for the same country. Where it disagrees with the average, the average is the one to distrust.",
    get: (c) => countryBenchmark(c.school?.country ?? c.job?.country)?.crosscheck ?? "",
  },
  {
    key: "salary_range", label: "Salary Range (country)", group: "package", scope: "both",
    help: "Low to high of what teachers report earning in this country, so the spread behind the average is visible. A wide range means the average says little about any one school.",
    get: (c) => {
      const hit = countryBenchmark(c.school?.country ?? c.job?.country);
      if (!hit) return "";
      const n = (v?: number) => (v ?? 0).toLocaleString("en-GB");
      return `USD ${n(hit.salary.min)}–${n(hit.salary.max)}`;
    },
  },
  {
    key: "package", label: "Package & Career Growth", group: "package", scope: "both",
    help: "Housing, flights, insurance, dependant places, CPD, progression.",
    get: (c) =>
      list(parseJsonColumn<string[]>(c.school?.package_json ?? null, [])) ||
      list(parseJsonColumn<string[]>(c.job?.benefits_json ?? null, [])),
  },

  // ---- contact --------------------------------------------------------
  {
    key: "school_email", label: "School Email", group: "contact", scope: "both",
    help: "General school inbox.",
    get: (c) => c.school?.school_email ?? "",
  },
  {
    key: "career_email", label: "Career Email", group: "contact", scope: "both",
    help: "Best recruitment/HR address found, including inside job-pack PDFs.",
    get: (c) => c.school?.career_email ?? "",
  },
  {
    key: "careers_page", label: "Careers Page", group: "contact", scope: "both",
    help: "URL of the school's vacancies page.",
    get: (c) => c.school?.careers_url ?? "",
  },
  {
    key: "all_emails", label: "All Emails Found", group: "contact", scope: "both",
    help: "Every address discovered, best first — useful when the top pick looks wrong.",
    get: (c) =>
      parseJsonColumn<DiscoveredEmail[]>(c.school?.emails_json ?? null, [])
        .slice(0, 8)
        .map((e) => `${e.email} (${e.kind})`)
        .join(", "),
  },

  // ---- job ------------------------------------------------------------
  {
    key: "job_title", label: "Job Title", group: "job", scope: "job",
    help: "Advertised role title.",
    get: (c) => c.job?.title ?? "",
  },
  {
    key: "seniority", label: "Role Level", group: "job", scope: "job",
    help: "Director of Sport / Head of Department / Teacher / Coach …",
    get: (c) => SENIORITY_LABELS[c.job?.pe_seniority ?? ""] ?? "",
  },
  {
    key: "job_url", label: "Job Link", group: "job", scope: "job",
    help: "Link to the advert.",
    get: (c) => c.job?.url ?? "",
  },
  {
    key: "source", label: "Source", group: "job", scope: "job",
    help: "Which board it came from.",
    get: (c) => SOURCE_LABELS[c.job?.source ?? ""] ?? "",
  },
  {
    key: "contract", label: "Contract", group: "job", scope: "job",
    help: "Full time / part time, permanent / fixed term.",
    get: (c) => c.job?.contract_type ?? "",
  },
  {
    key: "start_date", label: "Start Date", group: "job", scope: "job",
    help: "Advertised start date.",
    get: (c) => date(c.job?.start_date),
  },
  {
    key: "deadline", label: "Deadline", group: "job", scope: "job",
    help: "Application closing date.",
    get: (c) => date(c.job?.deadline_at),
  },
  {
    key: "days_left", label: "Days Left", group: "job", scope: "job",
    help: "Days until the deadline — sort by this to see what is urgent. Blank when no closing date is published.",
    get: (c) => {
      const d = daysUntil(c.job?.deadline_at);
      return d === null ? "" : d < 0 ? "closed" : String(d);
    },
  },
  {
    key: "apply_url", label: "Apply Link", group: "job", scope: "job",
    help: "Direct application URL where the board gives one.",
    get: (c) => c.job?.application_url ?? "",
  },
  {
    key: "application_form", label: "Form to Fill?", group: "job", scope: "job",
    help: "Whether the school makes you complete an application form — 'Yes — PDF' or 'Yes — Word' means a document to download, 'Yes — online' is filled in on the site. 'No' means none was mentioned, not that none exists.",
    get: (c) => formLabel(c.job?.app_form ? ({ kind: c.job.app_form } as ApplicationForm) : null),
  },
  {
    key: "form_link", label: "Form Link", group: "job", scope: "job",
    help: "Direct link to the downloadable application form, when one was found.",
    get: (c) => c.job?.app_form_url ?? "",
  },
  {
    key: "pe_score", label: "PE Match", group: "job", scope: "job",
    help: "0-100 confidence that this is a PE-linked role.",
    get: (c) => (c.job ? String(c.job.pe_score) : ""),
  },
  {
    key: "description", label: "Description", group: "job", scope: "job",
    help: "Advert text, trimmed to keep the sheet readable.",
    get: (c) => truncate((c.job?.description ?? "").replace(/\s+/g, " "), 800),
  },

  // ---- tracking -------------------------------------------------------
  {
    key: "my_status", label: "My Status", group: "tracking", scope: "job",
    help: "Where you stand with this role — set with 'npm run track'. A scrape never touches it.",
    get: (c) => MY_STATUS_LABEL[c.job?.my_status ?? ""] ?? "",
  },
  {
    key: "my_note", label: "My Note", group: "tracking", scope: "job",
    help: "Your own note, attached with --note when marking a status.",
    get: (c) => c.job?.my_note ?? "",
  },
  {
    key: "status", label: "Still Available?", group: "tracking", scope: "job",
    help: "Open, Possibly filled, or Closed — refreshed on every run.",
    get: (c) => STATUS_LABELS[c.job?.status ?? ""] ?? "",
  },
  {
    key: "first_seen", label: "First Seen", group: "tracking", scope: "job",
    help: "When this scraper first found the advert.",
    get: (c) => date(c.job?.first_seen_at),
  },
  {
    key: "last_seen", label: "Last Seen", group: "tracking", scope: "job",
    help: "Most recent run that still saw it listed.",
    get: (c) => date(c.job?.last_seen_at),
  },
  {
    key: "posted", label: "Posted", group: "tracking", scope: "job",
    help: "Date the school posted it.",
    get: (c) => date(c.job?.posted_at),
  },
  {
    key: "enriched_at", label: "Enriched", group: "tracking", scope: "both",
    help: "When the school profile was last refreshed.",
    get: (c) => date(c.school?.enriched_at),
  },
  {
    key: "country_rank", label: "Rank in Country", group: "tracking", scope: "school",
    help: "Position in the top-schools list for its country (directory mode), ranked on package and salary.",
    get: (c) => (c.school?.country_rank != null ? String(c.school.country_rank) : ""),
  },
  {
    key: "package_score", label: "Package Score", group: "package", scope: "school",
    help: "0-100, weighted by what each benefit is actually worth to an expat: housing and dependant school places count far more than a transport allowance. 0 means the package is not known yet, not that it is poor.",
    get: (c) => (c.school?.package_score ? String(c.school.package_score) : ""),
  },
  {
    key: "rank_basis", label: "Rank Basis", group: "package", scope: "school",
    help: "What the country rank was decided on. 'accreditation only' means the school has not been profiled yet, so its position is a proxy rather than evidence about pay.",
    get: (c) =>
      RANK_BASIS_LABEL[(c.school?.rank_basis ?? "") as keyof typeof RANK_BASIS_LABEL] ?? "",
  },
  {
    key: "accreditation", label: "Accreditation", group: "school", scope: "both",
    help: "Bodies accrediting the school (CIS, IB, NEASC, COBIS...). The closest thing to an objective quality signal in international schooling.",
    get: (c) => c.school?.accreditation ?? "",
  },
];

export const FIELD_MAP = new Map(FIELDS.map((f) => [f.key, f]));

/** Ticked by default: exactly the columns the brief asked for, plus context. */
export const DEFAULT_FIELDS = [
  "country", "city", "school_name", "curriculum", "pe_team_size", "student_count",
  "school_type", "salary_estimate", "package", "school_email", "career_email",
  "job_title", "seniority", "status", "job_url", "deadline", "source",
];

export function resolveFields(keys: string[], scope: "job" | "school"): FieldDef[] {
  const out: FieldDef[] = [];
  for (const key of keys) {
    const f = FIELD_MAP.get(key);
    if (!f) continue;
    if (f.scope !== "both" && f.scope !== scope) continue;
    out.push(f);
  }
  return out;
}
