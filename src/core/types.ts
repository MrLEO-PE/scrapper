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
  | "inspired";

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
   * Documents attached to the advert — job description packs, prospectuses.
   * Enrichment reads these for careers emails and school facts.
   */
  attachments?: string[];
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
  packageNotes?: Sourced<string[]>;
  schoolEmail?: Sourced<string>;
  careerEmail?: Sourced<string>;
  /** Every email found, classified; careerEmail is the best of these. */
  allEmails?: DiscoveredEmail[];
  careersPageUrl?: Sourced<string>;
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
