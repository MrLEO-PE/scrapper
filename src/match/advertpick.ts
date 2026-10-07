/**
 * The hook for an application: one real duty from the advert itself.
 *
 * Leo's model letter opens with something the school actually asks for,
 * answered with something he has actually built — "PBISS asks for a
 * progressive PE curriculum where progress is monitored and students get
 * clear feedback. That is the system I have built…". An advert is the one
 * place a duty is stated in the school's own words for this exact job, so it
 * is a better hook than anything read off a website.
 *
 * Two rules keep it honest:
 *   - the line is quoted exactly as written. It is chosen, never reworded.
 *   - it is only chosen when it genuinely matches something Leo can answer
 *     (assessment, events and coaching, IGCSE). No match means no hook from
 *     the advert, and the letter falls back to a fact about the school or to
 *     none at all. A wrong hook is worse than none.
 */

export type StrengthKey = "assessment" | "events" | "igcse";

export interface Duty {
  /** The line, exactly as the advert wrote it, without its bullet. */
  sentence: string;
  /** Which of my strengths answers it. */
  key: StrengthKey;
}

/**
 * Lines that are never a duty, however they are worded: legal and pay
 * boilerplate, the school describing itself, benefits and career marketing,
 * and the person specification (what you must already be, not what you will do).
 */
const NOT_A_DUTY =
  /\b(?:safeguard\w*|child\s+protection|disclosure|DBS|background\s+check|police\s+check|apply|application|closing\s+date|deadline|salary|remuneration|benefits?|allowance|housing|accommodation|visa|flights?|insurance|equal\s+opportunit\w*|committed\s+to|about\s+us|is\s+located|situated|founded|established|accredited|contract|CV|curriculum\s+vitae|QTS|PGCE|professional\s+development|career|mobility|opportunit\w*|track\s+record|proven|ability\s+to|able\s+to|passion\w*|experience\s+(?:of|in)|evidence\s+of|direct\s+reports?|reports?\s+to|invest\w*|qualification\w*|degree|licen[cs]e|certificat\w*|fluent|native|essential|underpinned|great\s+people|join\s+our)\b/i;

/** A duty is something to do, and an advert's bullet opens with the verb. */
const OPENS_WITH_VERB =
  /^(?:ensur\w*|lead\w*|deliver\w*|teach\w*|assess\w*|monitor\w*|track\w*|plan\w*|develop\w*|coach\w*|organi[sz]\w*|run\w*|manag\w*|support\w*|prepar\w*|mark\w*|report\w*|review\w*|promot\w*|provid\w*|design\w*|oversee\w*|co-?ordinat\w*|contribut\w*|participat\w*|supervis\w*|inspir\w*|model\w*|embed\w*|build\w*|maintain\w*|implement\w*|record\w*|evaluat\w*|work\w*|set\w*|creat\w*|encourag\w*|attend\w*|liais\w*|undertak\w*|help\w*|assist\w*|mentor\w*|take)\b/i;

/** What each strength answers in an advert. */
const MATCHERS: { key: StrengthKey; re: RegExp }[] = [
  {
    key: "assessment",
    // Real assessment words only — not "career progression" or "track record".
    re: /\b(?:assess\w*|feedback|monitor\w*|moderat\w*|self[\s-](?:review|assess\w*)|tracking|(?:student|pupil)s?['’]?\s+progress|progress\s+(?:of|data)|attainment|data)\b/gi,
  },
  {
    key: "events",
    re: /\b(?:fixtures?|tournaments?|inter[\s-]?(?:house|school)|house\s+(?:system|events?|competitions?)|events?|competitions?|co[\s-]?curricular|extra[\s-]?curricular|ECAs?|CCAs?|after[\s-]school|coach\w*|sports?\s+day|galas?)\b/gi,
  },
  {
    key: "igcse",
    re: /\b(?:IGCSE|Cambridge|GCSE|A[\s-]?Levels?|BTEC|examination|exam|syllabus|specification)\b/gi,
  },
];

/** When two strengths tie, the model letter's own order. */
const PRIORITY: StrengthKey[] = ["assessment", "events", "igcse"];

/** Lines of an advert: bullets and sentences, trimmed of their bullets. */
function lines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((l) => l.replace(/^[\s•●▪‣⁃*\-–—>•●]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const count = (re: RegExp, s: string): number => (s.match(re) ?? []).length;

/** A heading, a "Label: list", a shouted notice, or the school talking about itself. */
function isFurniture(line: string): boolean {
  if (/^[A-Z][A-Za-z &/-]{0,40}:?$/.test(line)) return true;
  if (/^[A-Z][\w &/,'’-]{2,30}:\s/.test(line)) return true;
  if (/^(?:we|our|the\s+school|this\s+(?:school|role|post|vacancy)|please|note)\b/i.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length > 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
}

/** The duty in this advert that best matches something I can answer, or null. */
export function pickDuty(advert: string | null | undefined): Duty | null {
  if (!advert) return null;

  let best: { duty: Duty; score: number } | null = null;

  for (const line of lines(advert)) {
    if (line.length < 35 || line.length > 200) continue;
    if (!/^[A-Z]/.test(line)) continue;
    if (NOT_A_DUTY.test(line) || isFurniture(line) || !OPENS_WITH_VERB.test(line)) continue;

    for (const m of MATCHERS) {
      const score = count(m.re, line);
      if (!score) continue;
      const better =
        !best ||
        score > best.score ||
        (score === best.score && PRIORITY.indexOf(m.key) < PRIORITY.indexOf(best.duty.key));
      if (better) best = { duty: { sentence: line.replace(/[.;:,\s]+$/, ""), key: m.key }, score };
    }
  }
  return best?.duty ?? null;
}
