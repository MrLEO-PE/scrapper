/**
 * Finding a person to write to.
 *
 * Most schools never publish a careers address — 447 of the top twenty in
 * each country have none. That is not the same as being unreachable. Almost
 * all of them publish a leadership page naming the Head, the Director of
 * Sport, the HR manager, and often their addresses.
 *
 * A speculative application needs a human. "Dear Sir/Madam" to info@ is the
 * version that gets deleted; "Dear Mr Okafor" to the Director of Sport who
 * actually runs the department is the version that gets read. So this looks
 * for a named person in a role that would care about a PE teacher, and the
 * closest address to them.
 *
 * Ranked by who is most use to this particular application, which is not the
 * same as most senior: the Director of Sport is the person who knows whether
 * they need another PE teacher next August, and is far likelier to reply than
 * a Head of School fielding a hundred such letters.
 */

import { htmlToText } from "../core/text.ts";
import { extractEmails } from "./email.ts";

export interface Person {
  name: string;
  role: string;
  /** The closest address on the page, when there is one. */
  email?: string;
  /** How useful this person is for a speculative PE application, 0..1. */
  score: number;
  foundAt: string;
}

/**
 * Roles worth writing to, best first.
 *
 * Sport leads the list deliberately. They are the hiring manager for this
 * subject, they read their own email, and a letter about PE lands on the
 * right desk first time.
 */
const ROLES: { re: RegExp; label: string; score: number }[] = [
  { re: /\b(?:director of sport|head of (?:pe|p\.e\.|physical education|sport|games|athletics)|pe co-?ordinator|sports? director|athletic director|head of faculty[ ,-]*(?:pe|sport))\b/i, label: "Director of Sport", score: 0.97 },
  { re: /\b(?:head of (?:human resources|hr)|hr (?:manager|director|officer|lead|business partner)|human resources (?:manager|director|officer)|recruitment (?:manager|officer|lead))\b/i, label: "HR", score: 0.95 },
  { re: /\b(?:head of school|head teacher|headteacher|headmaster|headmistress|executive principal|school director|director of school)\b/i, label: "Head of School", score: 0.85 },
  { re: /\bprincipal\b/i, label: "Principal", score: 0.84 },
  { re: /\b(?:deputy|vice|associate|assistant) (?:head|principal)\b|\bhead of (?:secondary|primary|senior school|middle school|high school)\b/i, label: "Deputy Head", score: 0.8 },
  { re: /\b(?:pa to the (?:principal|head)|executive assistant|personal assistant|principal'?s? (?:pa|assistant|secretary))\b/i, label: "Assistant to the Head", score: 0.78 },
  { re: /\b(?:business manager|school manager|operations manager|bursar)\b/i, label: "Business Manager", score: 0.6 },
];

const HONORIFIC = "(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor)\\.?";
/**
 * A space between the words of a name, and only a space.
 *
 * `\s` includes newlines, so a name ran across the line break at the end of
 * its list item and swallowed whatever came next — producing "Melissa Meyers
 * Fou", "YiYi Chang Cashier" and "Patrick Callaghan info@stpaulhanoi.com".
 * Every one of those would have gone out at the top of a real letter.
 */
const GAP = "[ \\u00a0]+";
const NAME = `(?:${HONORIFIC}${GAP})?[A-Z][a-zA-Z'’\\-]{1,20}(?:${GAP}[A-Z][a-zA-Z'’\\-]{1,20}){1,2}`;

/**
 * Words that look like names but are page furniture. Shares its purpose with
 * the guard in hooks.ts: "Senior Leadership Team" is not a person.
 */
const NOT_A_PERSON =
  /\b(?:school|academy|college|international|team|office|department|board|trust|group|education|campus|vision|mission|welcome|message|read|more|contact|apply|news|email|phone|tel|our|the|and|from|here|staff|faculty|leadership|senior|primary|secondary|middle|junior|elementary|curriculum|pastoral|executive|acting|interim|about|home|menu|skip|search|login|portal|calendar|admissions|enquiries|overview|history|values|ethos|governance|careers|vacancies|policies|parents|students|alumni|community|learning|academics|programmes|programs|facilities|events|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday)\b/i;

const looksLikeName = (raw: string): boolean => {
  const bare = raw.replace(new RegExp(`^${HONORIFIC}\\s+`), "").trim();
  if (bare.length < 5 || bare.length > 40) return false;
  if (NOT_A_PERSON.test(bare)) return false;
  const words = bare.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (!words.every((w) => /^[A-Z][a-zA-Z'’\-]{1,20}$/.test(w))) return false;
  /*
   * An all-capitals word is an acronym, not a given name. "About IICS" sat
   * beside "Head of School" in a navigation bar and came back as a person
   * called About IICS — a name that would have gone out on a real letter.
   */
  return !words.some((w) => w.length > 1 && w === w.toUpperCase());
};

/**
 * People named on a page, with the nearest address to each.
 *
 * Both orders are read, because schools write staff lists both ways:
 * "Jane Okafor — Director of Sport" and "Director of Sport: Jane Okafor".
 */
export function findPeople(html: string, foundAt: string, schoolName = ""): Person[] {
  const text = htmlToText(html).slice(0, 200_000);
  const schoolWords = new Set(
    schoolName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3),
  );

  // Addresses with their position, so the closest one to a name can be found.
  const located: { email: string; at: number }[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) {
    located.push({ email: m[0]!.toLowerCase(), at: m.index! });
  }
  // Run through the classifier so junk and student-careers addresses are
  // rejected here exactly as they are everywhere else.
  const allowed = new Set(extractEmails(text, foundAt, "html").map((e) => e.email));

  /*
   * The role is matched case-insensitively and the name case-sensitively, in
   * two steps rather than one pattern.
   *
   * One pattern cannot do both: a single `i` flag makes `[A-Z]` match
   * lowercase too, so the name part stopped constraining anything and ran on
   * into whatever followed. "Principal: Anna Meyer anna.meyer@school.edu"
   * yielded a person called "Anna Meyer anna", which the name check then
   * rejected — losing the real name sitting in front of it.
   */
  const SEP = "\\s*[—–\\-,|:·•]?\\s*";
  const out = new Map<string, Person>();
  for (const role of ROLES) {
    const finder = new RegExp(role.re.source, "gi");
    for (const hit of text.matchAll(finder)) {
      const before = text.slice(Math.max(0, hit.index! - 60), hit.index!);
      const after = text.slice(hit.index! + hit[0].length, hit.index! + hit[0].length + 60);

      const name =
        new RegExp(`^${SEP}(${NAME})`).exec(after)?.[1] ??
        new RegExp(`(${NAME})${SEP}$`).exec(before)?.[1] ??
        "";
      if (!name || !looksLikeName(name)) continue;
      const m = hit;
      // A name overlapping the school's own name is the school, not a person.
      const bare = name.replace(new RegExp(`^${HONORIFIC}\\s+`), "");
      if (bare.toLowerCase().split(/\s+/).some((w) => schoolWords.has(w))) continue;

      // The nearest allowed address, within a paragraph or so either way.
      let email: string | undefined;
      let best = 400;
      for (const e of located) {
        if (!allowed.has(e.email)) continue;
        const gap = Math.abs(e.at - m.index!);
        if (gap < best) { best = gap; email = e.email; }
      }

      const key = bare.toLowerCase();
      const prev = out.get(key);
      if (!prev || role.score > prev.score) {
        out.set(key, { name, role: role.label, email, score: role.score, foundAt });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

/** The one person to write to, or nobody. */
export function bestPerson(people: Person[]): Person | undefined {
  // Someone with an address beats someone without, at the same usefulness:
  // a name alone still helps ("FAO ..."), but a name with an address is a
  // letter you can send today.
  return [...people].sort((a, b) => b.score + (b.email ? 0.05 : 0) - (a.score + (a.email ? 0.05 : 0)))[0];
}
