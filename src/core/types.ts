/**
 * Canonical domain model.
 *
 * Every source normalises into `RawJob` -> `Job`. Enrichment attaches a
 * `SchoolProfile`. Export flattens `Job` + `SchoolProfile` into the columns the
 * user ticked.
 */

export type SourceId =
  | "tes"
  | "teachaway"
  | "teacherhorizons"
  // School groups running their own SuccessFactors career site.
  | "nordanglia"
  | "inspired"
  // A school's own careers page, from config/schools.json.
  | "schoolsite"
  // Job alerts received by email (the paid services' sanctioned feed).
  | "mailalert"
  | "europeanchamber"
  // School groups running their own Workday career site.
  | "isp";

/** How sure we are about a single enriched value, and where it came from. */
export interface Provenance {
  /** 0..1 — how much to trust this value. */
  confidence: number;
  /** Human-readable origin, e.g. "teachaway:schoolProfile" or a URL. */
  source: string;
  /** The exact snippet the value was read from, when scraped from prose. */
  evidence?: string;
}

/** A value plus where it came from. */
export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}

/** Seniority ladder for PE-linked roles. Ordered most senior -> least. */
export type Seniority =
  | "director_of_sport"
  | "head_of_department"
  | "second_in_department"
  | "coordinator"
  | "teacher"
  | "coach"
  | "support"
  | "unknown";

export const SENIORITY_RANK: Record<Seniority, number> = {
  director_of_sport: 100,
  head_of_department: 90,
  second_in_department: 70,
  coordinator: 60,
  teacher: 45,
  coach: 35,
  support: 20,
  unknown: 0,
};

/** School phase. Mirrors the user's "type of school" column. */
export type SchoolPhase = "primary" | "secondary" | "k12" | "university" | "other";

export interface Salary {
  min?: number;
  max?: number;
  currency?: string;
  /** MONTHLY | ANNUAL | WEEKLY | DAILY | HOURLY */
  period?: string;
  /** Free text when the numbers are not machine-readable. */
  text?: string;
}

export interface Attachment {
  url: string;
  /** The label the board gave it, e.g. "Job Description", "Application Form". */
  caption?: string;
}

/**
 * How a school wants to be applied to.
 *
 * The distinction matters: a downloadable form is work you must do before
 * applying, whereas an online form is filled in on the site. "none" means
 * nothing was stated, which is not the same as knowing there is no form.
 */
export type ApplicationFormKind = "pdf" | "word" | "online" | "none";

export interface ApplicationForm {
  kind: ApplicationFormKind;
  /** Direct link to the form, when one was found. */
  url?: string;
  /** Where this was established — a caption, a link, or advert wording. */
  evidence?: string;
}

/** Something you can evidence, matched against what an advert asks for. */
export interface Qualification {
  /** Matches a key in src/match/fit.ts. */
  key: string;
  label: string;
  /** How it is phrased in the email. */
  phrase: string;
}

/** What a source hands back before normalisation. */
export interface RawJob {
  source: SourceId;
  sourceJobId: string;
  title: string;
  url: string;
  schoolName?: string;
  country?: string;
  city?: string;
  description?: string;
  postedAt?: string;
  deadlineAt?: string;
  startDate?: string;
  salary?: Salary;
  contractType?: string;
  contractTerm?: string;
  curriculum?: string[];
  gradeLevels?: string[];
  benefits?: string[];
  schoolWebsite?: string;
  schoolEmails?: string[];
  applicationUrl?: string;
  /**
   * Documents attached to the advert — job description packs, prospectuses,
   * and sometimes an application form the candidate must fill in. Enrichment
   * reads these for careers emails and school facts; the caption is what
   * distinguishes a form from a brochure.
   */
  attachments?: Attachment[];
  /** How this school wants the application submitted, if stated. */
  applicationForm?: ApplicationForm;
  /** Untouched source payload, kept for debugging and re-parsing. */
  raw?: unknown;
}

/** PE classification result. */
export interface PeMatch {
  /** 0..100. Higher = more clearly a PE-linked role. */
  score: number;
  seniority: Seniority;
  /** Vocabulary terms that fired, for auditability. */
  matched: string[];
  /** Terms that vetoed the match (e.g. "physics"). */
  vetoed: string[];
  /** True once score clears the configured threshold. */
  isPe: boolean;
}

export interface Job extends RawJob {
  /** Stable cross-run identity: `${source}:${sourceJobId}`. */
  id: string;
  /** Cross-source identity used to collapse the same post on two boards. */
  dedupeKey: string;
  pe: PeMatch;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * The enrichment target. One row per school in the exported sheet, carrying the
 * columns the user ticked.
 */
export interface SchoolProfile {
  schoolKey: string;
  schoolName: string;
  country?: Sourced<string>;
  city?: Sourced<string>;
  website?: Sourced<string>;
  curriculum?: Sourced<string[]>;
  peTeamSize?: Sourced<number>;
  studentCount?: Sourced<number>;
  schoolType?: Sourced<SchoolPhase>;
  salaryEstimate?: Sourced<Salary>;
  /** Exactly what the salary figure is: one advert, an average, a benchmark. */
  salaryBasis?: string;
  /** Accrediting bodies, e.g. "CIS, IB" — the main signal behind a rank. */
  accreditation?: string;
  /**
   * The directory's proxy score. Only used to rank a school whose package is
   * not known yet; once it is, the package decides.
   */
  prominence?: number;
  packageNotes?: Sourced<string[]>;
  schoolEmail?: Sourced<string>;
  careerEmail?: Sourced<string>;
  /** A Facebook or Instagram page, when the school has no website. Never crawled. */
  social?: Sourced<string>;
  /** Yearly tuition, the best per-school proxy for what a school pays. */
  fees?: { low?: number; high?: number; currency?: string };
  /** Switchboard number, when the directory publishes one. */
  phone?: Sourced<string>;
  /** Every email found, classified; careerEmail is the best of these. */
  allEmails?: DiscoveredEmail[];
  careersPageUrl?: Sourced<string>;
  /** Details the prepared application email needs, from the school's site. */
  principal?: Sourced<string>;
  schoolHook?: Sourced<string>;
  peHook?: Sourced<string>;
  enrichedAt?: string;
  /** Non-fatal problems hit while enriching, surfaced in the report. */
  notes?: string[];
}

export type EmailKind = "careers" | "hr" | "admin" | "info" | "principal" | "other";

export interface DiscoveredEmail {
  email: string;
  kind: EmailKind;
  /** 0..1 — how likely this is the right address for a job application. */
  score: number;
  foundAt: string;
  /** "html" | "pdf" | "source" */
  via: string;
}
