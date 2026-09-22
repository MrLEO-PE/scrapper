/**
 * Vocabulary for recognising Physical-Education-linked roles.
 *
 * Kept as data (not code) so it can be tuned without touching the scorer.
 * Every pattern is anchored with word boundaries — `\bPE\b` must not fire on
 * "PENSION", and nothing may fire on "Physics".
 */

import type { Seniority } from "../core/types.ts";

export interface Term {
  /** Regex source, matched case-insensitively against the title/description. */
  re: RegExp;
  /** Points added when it matches. */
  weight: number;
  /** Label shown in the audit trail. */
  label: string;
}

/**
 * Unambiguous PE subject markers. Matching one of these is enough to call a
 * role PE-linked.
 */
export const CORE_TERMS: Term[] = [
  // Also catches "Physical Health Education" / "Physical and Health Education",
  // which several international schools use instead of plain "PE".
  { label: "physical education", re: /\bphysical\s+(?:(?:and\s+)?health\s+)?educat(?:ion|or)\b/i, weight: 55 },
  // "PE"/"P.E." as a standalone token. Requires a non-letter on both sides.
  { label: "PE", re: /(?<![a-z])p\.?\s?e\.?(?![a-z.])/i, weight: 50 },
  { label: "phys ed", re: /\bphys[\s.-]*ed\b/i, weight: 55 },
  { label: "PHE/HPE", re: /\b(?:h\.?p\.?e|p\.?h\.?e)\b/i, weight: 45 },
  { label: "health and physical education", re: /\bhealth\s*(?:&|and)\s*physical\b/i, weight: 55 },
  { label: "sports science", re: /\bsports?\s+science\b/i, weight: 45 },
  { label: "exercise science", re: /\bexercise\s+(?:science|physiology)\b/i, weight: 45 },
  { label: "SEHS (IB)", re: /\b(?:sehs|sports?,?\s*exercise\s*(?:&|and)\s*health\s*science)\b/i, weight: 50 },
  { label: "kinesiology", re: /\bkinesiolog/i, weight: 40 },
  { label: "BTEC sport", re: /\bbtec\s+(?:national\s+)?sport\b/i, weight: 45 },
  // Both word orders: "Games Teacher" and "Teacher of Games".
  { label: "games teacher", re: /\bgames\s+(?:teacher|master|mistress|staff|coach)\b|\b(?:teacher|master|mistress|head)\s+of\s+games\b/i, weight: 45 },
  { label: "head of games", re: /\bhead\s+of\s+games\b/i, weight: 50 },
  { label: "swimming teacher", re: /\bswim(?:ming)?\s+(?:teacher|instructor|coach|master)\b/i, weight: 40 },
];

/**
 * Sport/athletics markers. Strong in a school context but weaker on their own,
 * so they score lower than the core subject terms.
 */
export const SPORT_TERMS: Term[] = [
  { label: "director of sport", re: /\bdirector\s+of\s+(?:sports?|athletics?)\b/i, weight: 50 },
  { label: "athletic director", re: /\bathletics?\s+director\b/i, weight: 50 },
  { label: "head of sport", re: /\bhead\s+of\s+(?:sports?|athletics?)\b/i, weight: 50 },
  { label: "sports coordinator", re: /\bsports?\s+co[\s-]?ordinator\b/i, weight: 42 },
  { label: "sports department", re: /\bsports?\s+department\b/i, weight: 30 },
  { label: "sport/athletics", re: /\b(?:sports?|athletics?)\b/i, weight: 22 },
  { label: "strength and conditioning", re: /\bstrength\s*(?:&|and)\s*conditioning\b/i, weight: 35 },
  { label: "outdoor education", re: /\boutdoor\s+(?:education|learning|pursuits|adventure)\b/i, weight: 28 },
  { label: "Duke of Edinburgh", re: /\bduke\s+of\s+edinburgh\b|\bD\.?of\.?E\b/i, weight: 22 },
  { label: "co-curricular/activities", re: /\b(?:co[\s-]?curricular|extra[\s-]?curricular)\s+(?:co[\s-]?ordinator|lead)/i, weight: 18 },
];

/** Named sports — useful for coach roles that never say "PE". */
export const SPORT_NAMES: Term[] = [
  { label: "named sport", re: /\b(?:football|soccer|basketball|netball|rugby|cricket|tennis|volleyball|handball|badminton|hockey|athletics|gymnastics|swimming|aquatics|rowing|golf|baseball|softball|track\s*(?:&|and)\s*field)\b/i, weight: 26 },
];

/** Roles that signal coaching rather than classroom teaching. */
export const COACH_TERMS: Term[] = [
  { label: "coach", re: /\bcoach(?:ing)?\b/i, weight: 20 },
];

/**
 * Hard negatives. These fire on look-alikes; the scorer suppresses a match when
 * a veto is present and no core term is.
 */
export const VETO_TERMS: Term[] = [
  { label: "physics", re: /\bphysics?\b|\bphysicist\b/i, weight: 70 },
  { label: "physical science", re: /\bphysical\s+science/i, weight: 60 },
  { label: "physiotherapy", re: /\bphysio(?:therap|logy)/i, weight: 50 },
  { label: "physical therapy", re: /\bphysical\s+therap/i, weight: 50 },
  { label: "special education", re: /\bspecial\s+educational?\s+needs\b|\bsenco\b/i, weight: 40 },
  { label: "sports marketing/business", re: /\bsports?\s+(?:marketing|business|management\s+lectur)/i, weight: 35 },
  { label: "physical plant/facilities", re: /\bphysical\s+plant\b|\bgrounds\s*(?:man|keeper)\b/i, weight: 45 },
  // "Games" also means video games — keep those out of a PE search.
  { label: "video games/esports", re: /\b(?:video\s+game|game\s+(?:design|development)|gaming|esports?)\b/i, weight: 45 },
];

/** Title patterns that place a role on the seniority ladder. Order matters. */
export const SENIORITY_RULES: { re: RegExp; level: Seniority; label: string }[] = [
  { label: "director of sport", level: "director_of_sport", re: /\b(?:director\s+of\s+(?:sports?|athletics?|physical)|athletics?\s+director|head\s+of\s+(?:whole[\s-]school\s+)?(?:sport|athletics))/i },
  { label: "vice/deputy principal", level: "director_of_sport", re: /\b(?:vice|deputy)\s+(?:principal|head)\b/i },
  { label: "head of department", level: "head_of_department", re: /\b(?:head\s+of\s+(?:department|faculty|dept|pe|p\.e|physical\s+education|games)|hod\b|head\s+of\s+subject|subject\s+(?:leader|lead|head)|curriculum\s+(?:leader|lead|head)|faculty\s+(?:leader|head))/i },
  { label: "second in department", level: "second_in_department", re: /\b(?:second\s+in\s+(?:department|charge|dept)|2nd\s+in\s+(?:department|charge|dept)|assistant\s+head\s+of|deputy\s+head\s+of|assistant\s+(?:subject|curriculum)\s+leader)\b/i },
  { label: "coordinator", level: "coordinator", re: /\bco[\s-]?ordinator\b|\bcoordinator\b|\blead\s+(?:teacher|practitioner)\b/i },
  { label: "teacher", level: "teacher", re: /\b(?:teacher|teaching|lecturer|instructor|master|mistress|educator)\b/i },
  { label: "coach", level: "coach", re: /\bcoach(?:ing)?\b/i },
  { label: "support", level: "support", re: /\b(?:assistant|apprentice|intern(?:ship)?|graduate|technician|trainee|volunteer|gap\s*(?:year|student))\b/i },
];

/** Terms that suggest an international / expat-facing school. */
export const INTERNATIONAL_HINTS: Term[] = [
  { label: "international school", re: /\binternational\s+school\b/i, weight: 20 },
  { label: "curriculum", re: /\b(?:ib\b|international\s+baccalaureate|igcse|cambridge|a[\s-]?level|american\s+curriculum|british\s+curriculum)\b/i, weight: 15 },
  { label: "expat package", re: /\b(?:expat|relocation|flights?\s+home|housing\s+allowance|tax[\s-]free)\b/i, weight: 15 },
];
