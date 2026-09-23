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
  parseJsonColumn,
  type HiringHistory,
  type JobRow,
  type SchoolRow,
} from "../store/db.ts";
import { countryName, truncate } from "../core/text.ts";
import type { ApplicationForm, DiscoveredEmail, Salary } from "../core/types.ts";
import { formLabel } from "../match/appform.ts";
import { draftEmail, emailCell, loadProfile, resetProfile } from "./email.ts";
import { assessFit, fitSummary } from "../match/fit.ts";
import { BASIS_LABEL } from "../enrich/salary.ts";
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
export const resetHiring = (): void => {
  hiringCache = null;
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
  if (!h || h.monthsObserved < MIN_MONTHS_TO_JUDGE) return "";
  const perYear = h.postings / (h.monthsObserved / 12);
  if (perYear >= 3) return "High";
  if (perYear >= 1.5) return "Moderate";
  return "Low";
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
    key: "pe_roles_seen", label: "PE Roles Seen", group: "school", scope: "both",
    help: "How many separate PE vacancies this school has advertised since the scraper started watching. Repeated adverts hint at people not staying.",
    get: (c) => {
      const h = hiringFor(c.school?.school_key ?? c.job?.school_key);
      return h ? String(h.postings) : "";
    },
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
    key: "salary_estimate", label: "Approx. Salary (PE expat)", group: "package", scope: "both",
    help: "Indicative salary for an expat PE teacher, averaged from this school's adverts.",
    get: (c) =>
      formatSalary(parseJsonColumn<Salary | null>(c.school?.salary_json ?? null, null)) ||
      formatSalary(parseJsonColumn<Salary | null>(c.job?.salary_json ?? null, null)),
  },
  {
    key: "salary_basis", label: "Salary Basis", group: "package", scope: "both",
    help: "Exactly what the salary figure is — this advert, a figure from the job pack, an average of this school's adverts, or a benchmark. A number without a basis should not be trusted.",
    get: (c) => BASIS_LABEL[(c.school?.salary_basis ?? "") as keyof typeof BASIS_LABEL] ?? "",
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
