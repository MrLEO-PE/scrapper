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
import { schoolGroup } from "./groups.ts";
import { toUsd } from "../enrich/fx.ts";
import { annualMultiplier, salaryToUsd, salaryToUsdAverage } from "../enrich/salary.ts";

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
  seekteachers: "SeekTeachers",
  teachingnomad: "Teaching Nomad",
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

/**
 * The form standing between you and this application.
 *
 * A job row knows its own advert. A school row has no advert, so it answers
 * for the school's open roles instead, which is the useful reading on that
 * page: will applying here cost me an afternoon?
 */
function formOf(c: FieldContext): ApplicationForm | null {
  if (c.job) {
    return c.job.app_form
      ? ({ kind: c.job.app_form, url: c.job.app_form_url ?? undefined } as ApplicationForm)
      : null;
  }
  const open = openRolesFor(c.school?.school_key);
  return open?.form ? ({ kind: open.form, url: open.formUrl ?? undefined } as ApplicationForm) : null;
}

/**
 * Statuses that mean an application went out.
 *
 * "Interested" is a bookmark and "Not for me" is a decision not to apply, so
 * neither earns the tick. Everything past "applied" does: an interview is an
 * application you sent and then heard back about.
 */
const APPLIED = new Set(["applied", "interview", "offer", "rejected"]);

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
 * A salary, annualised and converted to USD so one school can be compared
 * against another regardless of what currency or pay period each quotes.
 *
 * Falls back to the original figure, visibly flagged, rather than dropping it
 * silently: a period this cannot safely annualise (weekly, daily, hourly) or
 * a currency the rate table has never heard of both leave the row honest
 * about what it could not do, instead of empty or wrong.
 */
function formatSalaryUsd(s: Salary | null | undefined): string {
  if (!s) return "";
  if (s.min == null && s.max == null) return s.text ?? "";

  const usd = salaryToUsd(s);
  if (!usd) {
    const unclear = annualMultiplier(s.period) == null ? "pay period" : "currency";
    return `${formatSalary(s)} (not converted — ${unclear} unclear)`;
  }
  const n = (v: number) => Math.round(v).toLocaleString("en-GB");
  const range = usd.min != null && usd.max != null && usd.min !== usd.max
    ? `${n(usd.min)}–${n(usd.max)}`
    : n((usd.max ?? usd.min)!);
  // A school already quoting USD annually converts to itself — repeating the
  // identical figure in brackets is noise, not evidence.
  const alreadyUsd = (s.currency ?? "").toUpperCase() === "USD" && annualMultiplier(s.period) === 1;
  return alreadyUsd ? `USD ${range}/year` : `USD ${range}/year (${formatSalary(s)})`;
}

/**
 * The best available annual USD estimate for a school — its own figure where
 * one exists, the country benchmark otherwise — used to decide which schools
 * are worth enriching first, not only how the sheet displays them.
 */
export function estimatedAnnualUsd(salary: Salary | null | undefined, country: string | null | undefined): number | null {
  return salaryToUsdAverage(salary) ?? benchmarkAverage(country);
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

/**
 * Days left to apply, counted in dates rather than elapsed hours.
 *
 * A closing date is a date: applications are open during it, and what a reader
 * wants is how many more dates they have. Dividing a millisecond gap by 24
 * hours answers a different question and answers it wrongly at both ends — a
 * deadline at 23:59 tonight came back as 1, so a role closing today was
 * labelled "tomorrow", and one closing at noon today could never read as 0.
 */
export function daysUntil(v: string | null | undefined): number | null {
  if (!v) return null;
  const when = new Date(v);
  if (Number.isNaN(when.getTime())) return null;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(when) - midnight(new Date())) / 86_400_000);
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

  const days = daysUntil(deadline) ?? 0;

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

  /*
   * A vacancies page is the school's own answer to "how do I apply", so it
   * qualifies every weaker contact below it. Email the inbox by all means, but
   * without this note the sheet said "general inbox" at 511 schools that had
   * published a proper application route, and the better route was invisible
   * unless you thought to check another column.
   */
  const page = s?.careers_url ? " — they have a vacancies page" : "";

  if (s?.school_email) return { value: s.school_email, kind: "general inbox" + page };

  // Anything the crawl found but did not rank highly enough to promote. A
  // named teacher's address still reaches a human at the school.
  const any = parseJsonColumn<DiscoveredEmail[]>(s?.emails_json ?? null, [])
    .sort((a, b) => b.score - a.score)[0];
  if (any) return { value: any.email, kind: `${any.kind} address` + page };

  const fromJob = parseJsonColumn<string[]>(c.job?.emails_json ?? null, [])[0];
  if (fromJob) return { value: fromJob, kind: "from the advert" + page };

  // No address anywhere. The page is a real route and a phone number is not,
  // so it goes first.
  if (s?.careers_url) return { value: s.careers_url, kind: "vacancies page — no email published" };

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
    help: "Primary, Secondary, Primary + Secondary, or University — and the group that owns the school, where it belongs to one. A group runs a group pay scale, a central HR desk that often recruits for every campus at once, and a transfer route between countries, so who owns a school is a fact about the job. Edit config/school-groups.json to add a brand.",
    get: (c) => {
      const phase = PHASE_LABELS[c.school?.school_type ?? ""] ?? "";
      const group = schoolGroup(c.school?.name ?? c.job?.school_name, c.school?.website ?? c.job?.school_website);
      if (!group) return phase;
      return phase ? `${phase} · ${group}` : group;
    },
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
    key: "fees", label: "Yearly Fees (student tuition, USD)", group: "package", scope: "both",
    help: "What the school charges a pupil for a year, converted to USD so one school can be compared against another regardless of local currency — the original figure follows in brackets. This is not your salary, but it is the only per-school money signal that exists, and a school charging three times its neighbour is not paying its teachers the same. A country salary average cannot tell schools apart; this can. A figure flagged 'implausible' converted to an amount no real school charges — almost always a scraping error in the original number — and should not be trusted for comparison until checked.",
    get: (c) => {
      const s = c.school;
      if (!s?.fee_low && !s?.fee_high) return "";
      const rawN = (v: number | null) => (v == null ? "?" : v.toLocaleString("en-GB"));
      const cur = s.fee_currency ? s.fee_currency + " " : "";
      const original = s.fee_low && s.fee_high
        ? `${cur}${rawN(s.fee_low)}–${rawN(s.fee_high)}`
        : `${cur}${rawN(s.fee_high ?? s.fee_low)}`;

      const lo = s.fee_low != null ? toUsd(s.fee_low, s.fee_currency) : null;
      const hi = s.fee_high != null ? toUsd(s.fee_high, s.fee_currency) : null;
      if (lo == null && hi == null) return `${original} (not converted — currency unclear)`;

      const n = (v: number) => Math.round(v).toLocaleString("en-GB");
      const range = lo != null && hi != null && lo !== hi ? `${n(lo)}–${n(hi)}` : n((hi ?? lo)!);
      /*
       * The most expensive international schools anywhere charge in the
       * region of USD 50-60k a year. Converting exposed six stored figures
       * well past that — one over USD 26 million — which is almost
       * certainly a scraping error in the original number (a units slip, or
       * the wrong figure on the page entirely), not a real fee. Flagging it
       * keeps the row visible rather than hiding a defect, while saying
       * plainly that it should not be trusted for comparison as it stands.
       */
      const highest = Math.max(lo ?? 0, hi ?? 0);
      const flag = highest > 100_000 ? " — implausible, needs checking" : "";
      return `USD ${range} (${original})${flag}`;
    },
  },
  {
    key: "salary_estimate", label: "Approx. Salary (PE expat, USD)", group: "package", scope: "both",
    help: "What this school pays, when it or its adverts say so, otherwise the country average — always read the Salary Basis column beside it. Converted to USD and annualised so every row is on the same footing; the original currency and pay period follow in brackets. A figure that could not be safely annualised (a weekly, daily or hourly rate) or whose currency is not recognised says so rather than guessing.",
    get: (c) => {
      const own =
        formatSalaryUsd(parseJsonColumn<Salary | null>(c.school?.salary_json ?? null, null)) ||
        formatSalaryUsd(parseJsonColumn<Salary | null>(c.job?.salary_json ?? null, null));
      if (own) return own;
      // Nobody publishes this school's pay. The country average is what is
      // actually knowable, and the basis column says that is what it is.
      const avg = benchmarkAverage(c.school?.country ?? c.job?.country);
      return avg ? `~USD ${Math.round(avg).toLocaleString("en-GB")}/year` : "";
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
    help: "How long is left to apply, in words. Blank when no closing date is published — half of adverts give none, and those close once the right person turns up.",
    get: (c) => {
      const d = daysUntil(c.job?.deadline_at);
      if (d === null) return "";
      if (d < 0) return "closed";
      if (d === 0) return "today";
      if (d === 1) return "tomorrow";
      return `${d} days`;
    },
  },
  {
    key: "apply_url", label: "Apply Link", group: "job", scope: "job",
    help: "Direct application URL where the board gives one.",
    get: (c) => c.job?.application_url ?? "",
  },
  {
    key: "application_form", label: "Form to Fill?", group: "job", scope: "both",
    help: "Whether the school makes you complete an application form — 'Yes — PDF' or 'Yes — Word' means a document to download, 'Yes — online' is filled in on the site, and a Google Form counts as online. 'link not found' means the advert says there is a form but never linked it, so look on the careers page. 'No' means none was mentioned, not that none exists. On the schools list this reflects the school's open roles.",
    get: (c) => formLabel(formOf(c)),
  },
  {
    key: "apply_type", label: "Apply Type", group: "job", scope: "job",
    help: "TES only: 'Quick Apply' goes straight through TES with your board profile, nothing further to fill in. 'Apply' hands you off to the school's own site or contact instead — check Form to Fill? beside it, since that is usually where the extra step is. Blank on every other board, which does not expose this distinction.",
    get: (c) => (c.job?.quick_apply == null ? "" : c.job.quick_apply ? "Quick Apply" : "Apply"),
  },
  {
    key: "write_to", label: "Who to Write To", group: "contact", scope: "both",
    help: "A named human for a speculative application, found on the school's leadership or contact pages, with their address where the page gave one. Only filled where no careers address exists — where one does, that is the better route. The Director of Sport ranks above the Head on purpose: they are the person who knows whether they need another PE teacher, and they answer their own email. Where only a name was found, send it to the School Email marked for their attention.",
    get: (c) => {
      const s = c.school;
      if (!s?.contact_name) return "";
      const who = s.contact_role ? `${s.contact_name} — ${s.contact_role}` : s.contact_name;
      return s.contact_email ? `${who} · ${s.contact_email}` : `${who} (no address — send to the school inbox, FAO them)`;
    },
  },
  {
    key: "form_link", label: "Form Link", group: "job", scope: "both",
    help: "The application form itself, when the advert linked it — a downloadable document, or a hosted form such as a Google Form. Blank means no link was found, not that there is no form; the Form to Fill? column beside it says which.",
    get: (c) => formOf(c)?.url ?? "",
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
    key: "applied", label: "Applied", group: "tracking", scope: "job",
    help: "A tick and the date once you have confirmed you applied, so a long list shows at a glance what is already dealt with. Set with 'npm run track'. Interested and Not-for-me are not applications and stay blank; a status past Applied names itself, because an interview is still an application you sent.",
    get: (c) => {
      const status = c.job?.my_status ?? "";
      if (!APPLIED.has(status)) return "";
      const when = c.job?.my_status_at ? new Date(c.job.my_status_at) : null;
      const on = when && !Number.isNaN(when.getTime())
        ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
        : "";
      // Past "applied" the stage is the more useful word, but the tick still
      // answers the question the column is there for.
      const stage = status === "applied" ? "" : ` · ${MY_STATUS_LABEL[status] ?? status}`;
      return `✅ ${on}${stage}`.replace("✅  ", "✅ ").trim();
    },
  },
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
