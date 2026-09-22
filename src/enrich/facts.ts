/**
 * Reading facts out of school-website prose.
 *
 * Every extractor returns the matched evidence alongside the value, so the
 * exported sheet can show where a number came from. Schools phrase these things
 * in many ways, so each pattern set is ordered most-reliable-first and the
 * first confident hit wins.
 */

import { parseCount } from "../core/text.ts";
import type { SchoolPhase } from "../core/types.ts";

export interface Extracted<T> {
  value: T;
  evidence: string;
  confidence: number;
}

/** Plausibility window for a school roll — filters out phone numbers and years. */
const MIN_STUDENTS = 30;
const MAX_STUDENTS = 12000;

const STUDENT_PATTERNS: { re: RegExp; confidence: number }[] = [
  { re: /\b(?:approximately|around|about|over|more\s+than|nearly|some|just\s+over)?\s*([0-9][0-9,\s]{1,6})\s*(?:\+\s*)?(?:students|pupils|learners|children)\s+(?:are\s+)?(?:enrolled|attend|study|from)/i, confidence: 0.9 },
  { re: /\b(?:enrolment|enrollment|roll|student\s+body|school\s+population)\s*(?:of|is|:|stands\s+at|currently)?\s*(?:approximately|around|about|over|nearly)?\s*([0-9][0-9,\s]{1,6})/i, confidence: 0.9 },
  { re: /\b(?:we\s+(?:have|educate|welcome)|home\s+to|educates?|serves?|welcomes?)\s+(?:approximately|around|about|over|more\s+than|nearly|some)?\s*([0-9][0-9,\s]{1,6})\s*(?:\+\s*)?(?:students|pupils|learners|children)/i, confidence: 0.88 },
  { re: /\b(?:approximately|around|about|over|more\s+than|nearly|some)\s*([0-9][0-9,\s]{1,6})\s*(?:\+\s*)?(?:students|pupils|learners)\b/i, confidence: 0.8 },
  { re: /\b([0-9][0-9,\s]{1,6})\s*(?:\+\s*)?(?:students|pupils|learners)\b/i, confidence: 0.6 },
];

export function extractStudentCount(text: string): Extracted<number> | null {
  for (const { re, confidence } of STUDENT_PATTERNS) {
    const m = re.exec(text);
    if (!m?.[1]) continue;
    const n = parseCount(m[1]);
    if (n == null || n < MIN_STUDENTS || n > MAX_STUDENTS) continue;
    return { value: n, evidence: snippet(text, m.index), confidence };
  }
  return null;
}

/** "a team of 6 PE teachers", "8 members of the PE department" */
const PE_TEAM_PATTERNS: { re: RegExp; confidence: number }[] = [
  { re: /\b(?:team|department|faculty)\s+of\s+([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:specialist\s+)?(?:pe|physical\s+education|sports?)\s*(?:teachers|staff|specialists|coaches)?/i, confidence: 0.9 },
  { re: /\b([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:full[\s-]time\s+)?(?:pe|physical\s+education)\s+(?:teachers|staff|specialists|teaching\s+staff)\b/i, confidence: 0.88 },
  { re: /\b(?:pe|physical\s+education|sports?)\s+(?:department|team|faculty)\s+(?:of|has|comprises|consists\s+of|includes|currently\s+has)\s+([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i, confidence: 0.88 },
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export function extractPeTeamSize(text: string): Extracted<number> | null {
  for (const { re, confidence } of PE_TEAM_PATTERNS) {
    const m = re.exec(text);
    if (!m?.[1]) continue;
    const token = m[1].toLowerCase();
    const n = WORD_NUMBERS[token] ?? parseCount(token);
    if (n == null || n < 1 || n > 60) continue;
    return { value: n, evidence: snippet(text, m.index), confidence };
  }
  return null;
}

/**
 * Count distinct staff whose listed role is PE. Used on staff/faculty pages,
 * where an explicit team size is rarely stated.
 */
const PE_STAFF_ROLE =
  /\b(?:pe|p\.e\.|physical\s+education|games|sports?)\s*(?:teacher|instructor|coach|coordinator|co-ordinator|specialist|master|mistress|department)\b|\b(?:teacher|head|director)\s+of\s+(?:pe|physical\s+education|sport|sports|games)\b/gi;

export function countPeStaff(text: string): Extracted<number> | null {
  const matches = text.match(PE_STAFF_ROLE);
  if (!matches?.length) return null;
  // De-duplicate identical role strings — a nav menu repeats them.
  const distinct = new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, " ").trim()));
  const n = matches.length;
  if (n < 2 || n > 60) return null;
  return {
    value: n,
    evidence: `${n} PE staff role mentions (${distinct.size} distinct)`,
    // Counting mentions is a proxy, not a headcount — flag it as weak.
    confidence: distinct.size > 1 ? 0.45 : 0.3,
  };
}

const CURRICULUM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\binternational\s+baccalaureate\b|\bIB\s+(?:world\s+school|diploma|programme|dp|myp|pyp)\b|\b(?:PYP|MYP|IBDP)\b/i, label: "IB" },
  { re: /\bIGCSE\b/i, label: "IGCSE" },
  { re: /\bcambridge\s+(?:international|assessment|primary|lower\s+secondary|curriculum)\b|\bCAIE\b/i, label: "Cambridge" },
  { re: /\bA[\s-]?levels?\b|\bGCE\s+A\s+level\b/i, label: "A Level" },
  { re: /\bGCSEs?\b/i, label: "GCSE" },
  { re: /\bbritish\s+curriculum\b|\bnational\s+curriculum\s+(?:for|of)\s+england\b|\bEYFS\b|\bkey\s+stage\s*[1-5]\b/i, label: "British" },
  { re: /\bamerican\s+curriculum\b|\bUS\s+curriculum\b|\bcommon\s+core\b|\bAdvanced\s+Placement\b|\bAP\s+courses?\b|\bhigh\s+school\s+diploma\b/i, label: "American" },
  { re: /\bAustralian\s+curriculum\b|\bWACE\b|\bHSC\b/i, label: "Australian" },
  { re: /\bCanadian\s+curriculum\b|\bOntario\s+(?:curriculum|secondary\s+school\s+diploma)\b|\bOSSD\b/i, label: "Canadian" },
  { re: /\bBTEC\b/i, label: "BTEC" },
  { re: /\bfrench\s+(?:curriculum|baccalaur)|\bAEFE\b|\bbaccalaur[ée]at\b/i, label: "French" },
  { re: /\bIndian\s+curriculum\b|\bCBSE\b|\bICSE\b/i, label: "Indian" },
];

export function extractCurriculum(text: string): Extracted<string[]> | null {
  const found: string[] = [];
  const hits: string[] = [];
  for (const { re, label } of CURRICULUM_PATTERNS) {
    const m = re.exec(text);
    if (m && !found.includes(label)) {
      found.push(label);
      hits.push(m[0]);
    }
  }
  if (!found.length) return null;
  return {
    value: found,
    evidence: hits.slice(0, 4).join("; "),
    confidence: found.length > 1 ? 0.85 : 0.7,
  };
}

const PHASE_PATTERNS: { re: RegExp; phase: SchoolPhase; confidence: number }[] = [
  { re: /\b(?:university|college\s+of\s+higher\s+education|higher\s+education\s+institution|faculty\s+of)\b/i, phase: "university", confidence: 0.75 },
  { re: /\b(?:K-?12|kindergarten\s+(?:to|through|-)\s*(?:grade\s*)?12|pre[\s-]?k\s*(?:to|-)\s*(?:grade\s*)?12|from\s+(?:nursery|early\s+years|age\s*3)\s+(?:to|through)\s+(?:18|sixth\s+form|grade\s*12))\b/i, phase: "k12", confidence: 0.9 },
  { re: /\b(?:whole[\s-]school|all[\s-]through\s+school|3\s*(?:-|to)\s*18)\b/i, phase: "k12", confidence: 0.8 },
  { re: /\b(?:secondary\s+school|high\s+school|senior\s+school|middle\s+school|sixth\s+form)\b/i, phase: "secondary", confidence: 0.7 },
  { re: /\b(?:primary\s+school|elementary\s+school|junior\s+school|infant\s+school|pre[\s-]?school|kindergarten|early\s+years)\b/i, phase: "primary", confidence: 0.7 },
];

export function extractPhase(text: string): Extracted<SchoolPhase> | null {
  // Primary + secondary mentioned together means an all-through school.
  const hasPrimary = /\b(?:primary|elementary|junior\s+school|kindergarten|early\s+years)\b/i.test(text);
  const hasSecondary = /\b(?:secondary|high\s+school|senior\s+school|sixth\s+form)\b/i.test(text);
  if (hasPrimary && hasSecondary) {
    return { value: "k12", evidence: "mentions both primary and secondary phases", confidence: 0.75 };
  }
  for (const { re, phase, confidence } of PHASE_PATTERNS) {
    const m = re.exec(text);
    if (m) return { value: phase, evidence: snippet(text, m.index), confidence };
  }
  return null;
}

/**
 * Benefits and package terms, for the "Package" column. Looks for the things an
 * expat teacher actually compares offers on.
 */
const PACKAGE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\btax[\s-]?free\s+salary\b|\btax[\s-]?free\b/i, label: "Tax-free salary" },
  { re: /\b(?:free|subsidised|subsidized|provided)\s+(?:furnished\s+)?accommodation\b|\bhousing\s+(?:allowance|provided)\b|\baccommodation\s+(?:allowance|provided|included)\b/i, label: "Housing / accommodation" },
  { re: /\b(?:annual\s+)?(?:return\s+)?flights?\s+(?:home|allowance|provided|to\s+home\s+country)\b|\bairfare\b|\brepatriation\s+flight/i, label: "Flights" },
  { re: /\b(?:medical|health)\s+insurance\b|\bhealthcare\s+(?:cover|provided)\b/i, label: "Medical insurance" },
  { re: /\b(?:free|subsidised|subsidized|discounted)\s+(?:school\s+)?(?:places|tuition|education)\s+for\s+(?:dependants|dependents|children)\b|\btuition\s+(?:waiver|remission)\b|\bschool\s+places\s+for\s+children\b/i, label: "Dependant school places" },
  { re: /\brelocation\s+(?:allowance|package|assistance|support)\b|\bshipping\s+allowance\b|\bsettling[\s-]in\s+allowance\b/i, label: "Relocation support" },
  { re: /\bend[\s-]of[\s-]service\s+(?:gratuity|benefit)\b|\bgratuity\b|\bseverance\b/i, label: "End-of-service gratuity" },
  { re: /\bvisa\s+(?:sponsorship|provided|costs?\s+covered)\b|\bwork\s+permit\s+(?:provided|sponsored)\b/i, label: "Visa sponsorship" },
  { re: /\bpension\s+(?:scheme|contribution)\b|\bprovident\s+fund\b/i, label: "Pension" },
  { re: /\bprofessional\s+(?:development|learning)\b|\bCPD\b|\bPD\s+(?:budget|allowance|opportunities)\b/i, label: "Professional development" },
  { re: /\b(?:career\s+(?:progression|development|growth|advancement)|leadership\s+(?:pathway|opportunities|development)|promotion\s+opportunities|route\s+to\s+(?:leadership|headship))\b/i, label: "Career progression" },
  { re: /\b(?:utilities|electricity|water)\s+(?:allowance|included|covered)\b/i, label: "Utilities" },
  { re: /\btransport(?:ation)?\s+(?:allowance|provided)\b|\bcar\s+allowance\b/i, label: "Transport" },
  { re: /\bbonus\b|\bretention\s+(?:bonus|payment)\b|\bcompletion\s+bonus\b/i, label: "Bonus" },
];

export function extractPackage(text: string): Extracted<string[]> | null {
  const found: string[] = [];
  const hits: string[] = [];
  for (const { re, label } of PACKAGE_PATTERNS) {
    const m = re.exec(text);
    if (m && !found.includes(label)) {
      found.push(label);
      hits.push(m[0].trim());
    }
  }
  if (!found.length) return null;
  return { value: found, evidence: hits.slice(0, 5).join("; "), confidence: 0.8 };
}

/** A readable window of text around a match, for the evidence column. */
function snippet(text: string, index: number, width = 140): string {
  const start = Math.max(0, index - 30);
  return text
    .slice(start, start + width)
    .replace(/\s+/g, " ")
    .trim();
}
