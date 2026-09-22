/**
 * Scores a vacancy for "is this a PE-linked role?" and places it on the
 * seniority ladder.
 *
 * The title carries far more signal than the body text, so title matches score
 * at full weight and description matches are discounted. A veto term (Physics,
 * physiotherapy, ...) suppresses the match unless a core PE term is also
 * present — that way "Physics and PE Teacher" still qualifies while "Teacher of
 * Physics" does not.
 */

import type { PeMatch, Seniority } from "../core/types.ts";
import {
  COACH_TERMS,
  CORE_TERMS,
  SENIORITY_RULES,
  SPORT_NAMES,
  SPORT_TERMS,
  VETO_TERMS,
  type Term,
} from "./taxonomy.ts";

/** Description matches count for this fraction of their weight. */
const BODY_DISCOUNT = 0.25;
/** Score at or above which a role is reported as PE-linked. */
export const DEFAULT_THRESHOLD = 40;

interface Hit {
  label: string;
  weight: number;
  inTitle: boolean;
}

function scan(terms: Term[], title: string, body: string): Hit[] {
  const hits: Hit[] = [];
  for (const t of terms) {
    if (t.re.test(title)) {
      hits.push({ label: t.label, weight: t.weight, inTitle: true });
    } else if (body && t.re.test(body)) {
      hits.push({ label: t.label, weight: t.weight * BODY_DISCOUNT, inTitle: false });
    }
  }
  return hits;
}

export function detectSeniority(title: string, body = ""): Seniority {
  for (const rule of SENIORITY_RULES) {
    if (rule.re.test(title)) return rule.level;
  }
  // Fall back to the body only for leadership signals, which are usually
  // restated in the advert ("reporting to the Head of Department").
  for (const rule of SENIORITY_RULES) {
    if (rule.level === "teacher" || rule.level === "support") continue;
    if (body && rule.re.test(body)) return rule.level;
  }
  return "unknown";
}

export interface ClassifyOptions {
  threshold?: number;
  /** Cap the body text scanned, for speed on very long adverts. */
  bodyLimit?: number;
}

export function classify(
  title: string,
  description = "",
  opts: ClassifyOptions = {},
): PeMatch {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const t = title || "";
  const body = (description || "").slice(0, opts.bodyLimit ?? 6000);

  const core = scan(CORE_TERMS, t, body);
  const sport = scan(SPORT_TERMS, t, body);
  const names = scan(SPORT_NAMES, t, body);
  const coach = scan(COACH_TERMS, t, body);
  const vetoes = scan(VETO_TERMS, t, body);

  const coreInTitle = core.some((h) => h.inTitle);
  const hasCore = core.length > 0;

  // Best single hit per family, plus a small bonus for corroboration. Summing
  // every hit would let a long advert that says "sport" ten times outrank a
  // title that says "Head of PE".
  const best = (hs: Hit[]) => (hs.length ? Math.max(...hs.map((h) => h.weight)) : 0);
  const corroboration = Math.min(12, (core.length + sport.length + names.length - 1) * 4);

  let score =
    best(core) +
    best(sport) * (hasCore ? 0.35 : 1) +
    best(names) * (hasCore || sport.length ? 0.3 : 1) +
    best(coach) * (hasCore ? 0.2 : 0.8) +
    Math.max(0, corroboration);

  // A coaching role tied to sport is PE-linked even with no subject term:
  // "Athletic Coach", "Basketball Coach", "Head Swimming Coach".
  if (!hasCore && coach.length && (names.length || sport.length)) score += 15;

  const vetoWeight = best(vetoes);
  const vetoInTitle = vetoes.some((h) => h.inTitle);

  if (vetoWeight > 0) {
    if (!coreInTitle && vetoInTitle) {
      // "Teacher of Physics" — kill it.
      score -= vetoWeight;
    } else if (!hasCore) {
      score -= vetoWeight * 0.6;
    } else {
      // Core term present as well: mild penalty only.
      score -= vetoWeight * 0.15;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const matched = [
    ...core.map(tag("subject")),
    ...sport.map(tag("sport")),
    ...names.map(tag("sport-name")),
    ...coach.map(tag("coach")),
  ];

  return {
    score,
    seniority: detectSeniority(t, body),
    matched,
    vetoed: vetoes.map((h) => h.label + (h.inTitle ? " (title)" : " (body)")),
    isPe: score >= threshold,
  };
}

const tag = (family: string) => (h: Hit) =>
  `${family}:${h.label}${h.inTitle ? "" : " (body)"}`;

/**
 * Priority for ranking results. The user's focus is leadership roles, so
 * seniority dominates and the PE score breaks ties.
 */
export function priority(pe: PeMatch): number {
  const bySeniority: Record<Seniority, number> = {
    director_of_sport: 1000,
    head_of_department: 900,
    second_in_department: 700,
    coordinator: 600,
    teacher: 400,
    coach: 300,
    support: 150,
    unknown: 200,
  };
  return bySeniority[pe.seniority] + pe.score;
}
