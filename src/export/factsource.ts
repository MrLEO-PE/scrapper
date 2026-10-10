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
import { expiredFor, verifiedFor } from "./verifiednames.ts";

/** "verified" is the only kind a letter greets by name; the rest are candidates a person has not yet confirmed. */
export type PrincipalSourceKind = "verified" | "school-page" | "advert" | "unknown";

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

/**
 * What a letter may say about a school's principal.
 *
 * A name a person has confirmed (verifiednames.ts) is used. Anything the scraper
 * read off a page is only a candidate: it is carried along so the letter can say
 * who it might be and where to check, but it is never used in a greeting.
 */
export function principalFor(s: Pick<SchoolRow, "principal" | "provenance_json" | "enriched_at"> & { name?: string; school_key?: string }) {
  const verified = verifiedFor(s.school_key);
  if (verified) {
    return { principal: verified.name, principalSource: { kind: "verified" as const, where: verified.source, seenAt: verified.verifiedOn } };
  }
  // A candidate is cleaned of menu words, but it is still not confirmed.
  const candidate = cleanPersonName(s.principal, s.name);
  const expired = expiredFor(s.school_key);
  return {
    principal: candidate,
    principalSource: candidate ? principalSource(s) : undefined,
    // A confirmation that has run out is not used, but is worth saying: someone
    // checked this name once, and it only needs checking again.
    expiredName: expired?.name,
  };
}
