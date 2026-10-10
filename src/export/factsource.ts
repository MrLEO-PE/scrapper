/**
 * Where a name came from, and how old it is.
 *
 * Rule 2 of the letter model: the principal's name comes from the school's own
 * page, and if two sources disagree the school's page wins. The database already
 * records where each value was read (`provenance_json`), so the letter can know
 * whether a name is the school's own word or something said about it elsewhere.
 *
 * People change in July and August, so a name last read a long time ago is
 * flagged for a re-check before the hiring season rather than trusted.
 */

import type { SchoolRow } from "../store/db.ts";
import { cleanPersonName } from "../enrich/personname.ts";

export type PrincipalSourceKind = "school-page" | "advert" | "unknown";

export interface PrincipalSource {
  kind: PrincipalSourceKind;
  /** The page it was read from, for a school page. */
  where?: string;
  /** When the school was last read. */
  seenAt?: string | null;
}

/** A name last read longer ago than this is re-checked, not trusted. */
export const STALE_NAME_DAYS = 270;

export function principalSource(s: Pick<SchoolRow, "provenance_json" | "enriched_at">): PrincipalSource {
  let source: string | undefined;
  try {
    source = (JSON.parse(s.provenance_json ?? "{}") as { principal?: { source?: string } }).principal?.source;
  } catch {
    source = undefined;
  }
  if (!source) return { kind: "unknown", seenAt: s.enriched_at };
  if (/job\s+advert/i.test(source)) return { kind: "advert", seenAt: s.enriched_at };
  if (/^https?:\/\//i.test(source)) return { kind: "school-page", where: source, seenAt: s.enriched_at };
  return { kind: "unknown", seenAt: s.enriched_at };
}

/** Whole months since an ISO date, or null. */
export function monthsAgo(iso: string | null | undefined, now = Date.now()): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : Math.floor((now - t) / (30.44 * 86_400_000));
}

export function isStale(src: PrincipalSource, now = Date.now()): boolean {
  const m = monthsAgo(src.seenAt, now);
  return m !== null && m * 30.44 > STALE_NAME_DAYS;
}

/** The two things a letter needs about a school's principal. */
export function principalFor(s: Pick<SchoolRow, "principal" | "provenance_json" | "enriched_at"> & { name?: string }) {
  // Cleaned when read, whatever was stored: about a third of the names on file
  // carried menu words or the next line of the page, and a name that is not
  // clearly a person is not used in a greeting.
  const principal = cleanPersonName(s.principal, s.name);
  return { principal, principalSource: principal ? principalSource(s) : undefined };
}
