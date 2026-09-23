/**
 * How well a role matches what you actually offer.
 *
 * This is the objective half of an application. A hook shows you looked at the
 * school; a fit signal shows you meet what they asked for — and unlike a hook,
 * it is checkable, because the requirement is written in the advert.
 *
 * Only requirements the advert genuinely states are reported. Claiming to meet
 * a requirement nobody asked for reads as padding, and claiming one you do not
 * hold is worse, so both sides are matched from data: the advert's text against
 * `config/profile.json`.
 */

import type { Qualification } from "../core/types.ts";

export interface FitSignal {
  /** What the school asked for, in their words. */
  requirement: string;
  /** The label from your profile that answers it. */
  offer: string;
  /** Sentence fragment for the email. */
  phrase: string;
}

export interface FitResult {
  signals: FitSignal[];
  /** Requirements the advert states that your profile does not answer. */
  gaps: string[];
  /** 0..100 — how much of what they asked for you can evidence. */
  score: number;
}

/**
 * Things international schools routinely require of a PE teacher. Each has a
 * pattern for spotting it in an advert and a key your profile can claim.
 */
export const REQUIREMENTS: { key: string; label: string; re: RegExp }[] = [
  { key: "igcse", label: "IGCSE PE", re: /\bIGCSE\b|\bI\.?G\.?C\.?S\.?E\b/i },
  { key: "cambridge", label: "Cambridge curriculum", re: /\bCambridge\b|\bCAIE\b|\bCIE\b/i },
  { key: "alevel", label: "A Level PE", re: /\bA[\s-]?Level\b|\bAS\/A2\b|\bsixth\s+form\b/i },
  { key: "ib", label: "IB", re: /\b(?:IB|International\s+Baccalaureate)\b/i },
  { key: "myp", label: "IB MYP", re: /\bMYP\b|\bMiddle\s+Years\s+Programme\b/i },
  { key: "dp", label: "IB DP", re: /\b(?:IBDP|DP)\b|\bDiploma\s+Programme\b/i },
  { key: "pyp", label: "IB PYP", re: /\bPYP\b|\bPrimary\s+Years\s+Programme\b/i },
  { key: "sehs", label: "IB Sports, Exercise and Health Science", re: /\bSEHS\b|\bSports,?\s*Exercise\s*(?:&|and)\s*Health\s*Science\b/i },
  { key: "btec", label: "BTEC Sport", re: /\bBTEC\b/i },
  { key: "gcse", label: "GCSE PE", re: /\bGCSE\b/i },
  { key: "coordination", label: "coordination / leading a team", re: /\b(?:co[\s-]?ordinat\w+|head\s+of|lead(?:ing|ership)?\s+(?:a\s+)?(?:team|department|phase)|second\s+in\s+(?:department|charge)|subject\s+lead\w*|curriculum\s+lead\w*)\b/i },
  { key: "british", label: "British curriculum", re: /\bBritish\s+curriculum\b|\bNational\s+Curriculum\b|\bKey\s+Stage\b|\bEYFS\b/i },
  { key: "american", label: "American curriculum", re: /\bAmerican\s+curriculum\b|\bCommon\s+Core\b|\bAP\b|\bAdvanced\s+Placement\b/i },
  { key: "swimming", label: "swimming teaching", re: /\bswim(?:ming)?\b|\baquatics?\b|\bpool\b/i },
  { key: "primary", label: "primary PE", re: /\bprimary\b|\belementary\b|\bEYFS\b|\bearly\s+years\b/i },
  { key: "secondary", label: "secondary PE", re: /\bsecondary\b|\bhigh\s+school\b|\bmiddle\s+school\b|\bsenior\s+school\b/i },
  { key: "coaching", label: "sports coaching", re: /\bcoach(?:ing)?\b|\bteam\s+sports?\b|\bfixtures?\b|\binter[\s-]?school\b/i },
  { key: "ccas", label: "co-curricular / ECAs", re: /\b(?:co[\s-]?curricular|extra[\s-]?curricular|ECAs?|CCAs?|after[\s-]?school\s+activit)\b/i },
  { key: "dofe", label: "Duke of Edinburgh", re: /\bDuke\s+of\s+Edinburgh\b|\bD\.?of\.?E\b|\bIAward\b/i },
  { key: "outdoor", label: "outdoor education", re: /\boutdoor\s+(?:education|learning|pursuits)\b|\bexpedition\b/i },
  { key: "data", label: "tracking progress with data", re: /\b(?:data[\s-]?(?:driven|informed)|track(?:ing)?\s+progress|assessment\s+data|progress\s+monitoring)\b/i },
];

const BY_KEY = new Map(REQUIREMENTS.map((r) => [r.key, r]));

/**
 * Compare an advert against what you hold.
 *
 * `held` comes from your profile; anything you do not claim is reported as a
 * gap rather than quietly skipped, because knowing what a school wants that you
 * lack is as useful as knowing what matches.
 */
export function assessFit(advertText: string, held: Qualification[]): FitResult {
  const text = advertText ?? "";
  if (!text.trim() || !held.length) return { signals: [], gaps: [], score: 0 };

  const heldByKey = new Map(held.map((q) => [q.key, q]));
  const signals: FitSignal[] = [];
  const gaps: string[] = [];

  for (const req of REQUIREMENTS) {
    // Only requirements this advert actually states.
    if (!req.re.test(text)) continue;

    const mine = heldByKey.get(req.key);
    if (mine) signals.push({ requirement: req.label, offer: mine.label, phrase: mine.phrase });
    else gaps.push(req.label);
  }

  const asked = signals.length + gaps.length;
  const score = asked === 0 ? 0 : Math.round((signals.length / asked) * 100);
  return { signals, gaps, score };
}

/**
 * One sentence naming what you bring that they asked for.
 *
 * Capped at three, because a list of everything reads as a CV dump rather than
 * an answer to their advert.
 */
export function fitSentence(fit: FitResult): string {
  const phrases: string[] = [];
  const used = new Set<string>();

  for (const signal of fit.signals) {
    // Requirements overlap — IGCSE and Cambridge both fire on the same advert —
    // and their phrases then repeat each other. Keep the first, drop the echo.
    const words = significantWords(signal.phrase);
    const overlap = words.filter((w) => used.has(w)).length;
    if (words.length && overlap / words.length > 0.5) continue;

    phrases.push(signal.phrase);
    for (const w of words) used.add(w);
    if (phrases.length === 3) break;
  }

  if (!phrases.length) return "";
  if (phrases.length === 1) return phrases[0]!;
  return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

const FILLER = new Set([
  "i", "my", "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for",
  "with", "within", "across", "have", "has", "had", "am", "is", "are", "been",
  "build", "own", "so", "can", "see", "their", "as", "well",
]);

function significantWords(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
}

/** Short summary for the sheet, e.g. "IGCSE PE · Cambridge · coordination". */
export function fitSummary(fit: FitResult): string {
  return fit.signals.map((s) => s.requirement).join(" · ");
}

export function requirementLabel(key: string): string | undefined {
  return BY_KEY.get(key)?.label;
}
