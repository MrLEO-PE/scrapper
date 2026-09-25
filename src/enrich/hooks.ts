/**
 * The three personal details an application email needs, taken from the
 * school's own website:
 *
 *   principal   who to address it to
 *   schoolHook  something specific and real about the school
 *   peHook      something specific and real about their PE / sport
 *
 * The governing rule is that nothing here may be invented. A wrong Principal's
 * name is far worse than a blank, so extraction is deliberately strict and
 * returns nothing whenever it is not confident. The caller reports the gap
 * rather than papering over it.
 *
 * Testing this against real school sites turned up the failure modes that
 * matter: "Hillview International School" and "Principal's Perspective" both
 * look like a person's name to a naive pattern.
 */

import { htmlToText } from "../core/text.ts";

export interface Hook {
  text: string;
  /** Page it came from. */
  source: string;
}

const HONORIFIC = "(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor)\\.?";
const TITLE =
  "(?:Principal|Head of School|Head of the School|Headmaster|Headmistress|Head Teacher|Headteacher|Executive Principal|Director of School|School Director)";
/** A person's name: two or three capitalised words. */
const NAME_CORE = "[A-Z][a-zA-Z'’\\-]{1,20}(?:\\s+[A-Z][a-zA-Z'’\\-]{1,20}){1,2}";

const WITH_HONORIFIC = `${HONORIFIC}\\s+${NAME_CORE}`;

/**
 * Words that appear in page furniture rather than in names. "Principal's
 * Perspective" and "Welcome from the Head" both matched before these.
 */
const NOT_A_PERSON =
  /\b(?:school|academy|college|international|perspective|message|welcome|greeting|statement|team|office|department|board|trust|group|education|campus|vision|mission|our|the|and|from|about|read|more|here|contact|apply|blog|news|deputy|assistant|vice|associate|co-?ordinators?|teachers?|staff|faculty|directors?|managers?|leaders?|heads?|principal|secretary|registrar|admissions|governors?|parents?|students?|alumni|learning|primary|secondary|senior|junior|middle|elementary|curriculum|pastoral|wellbeing|executive|acting|interim|founding|elect|designate)\b/i;

/**
 * Short words that begin a following sentence rather than continue a name.
 * A full stop lost in HTML-to-text joins them onto the name.
 */
const STOPWORD = new Set([
  "it", "is", "in", "at", "as", "we", "he", "she", "of", "on", "to", "by",
  "or", "an", "a", "the", "our", "his", "her", "its", "this", "that", "was",
  "has", "had", "who", "all", "for", "and", "but", "you", "they",
]);

/** Extract a Principal's name, or nothing. */
export function findPrincipal(html: string, sourceUrl: string, schoolName = ""): Hook | null {
  const text = htmlToText(html).slice(0, 200_000);

  // Words from the school's own name, so "Hillview International School" is
  // never mistaken for a person.
  const schoolWords = new Set(
    schoolName
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2),
  );

  const accept = (candidate: string): string | null => {
    const name = candidate.replace(/\s+/g, " ").trim();
    const bare = name.replace(new RegExp(`^${HONORIFIC}\\s+`), "").trim();

    if (bare.length < 5 || bare.length > 40) return null;
    if (NOT_A_PERSON.test(bare)) return null;

    const words = bare.split(" ");
    if (words.length < 2 || words.length > 3) return null;
    // Every word must look like a name, not a sentence fragment.
    if (!words.every((w) => /^[A-Z][a-zA-Z'’\-]{1,20}$/.test(w))) return null;
    // Short capitalised words are sentence starts, not names: "Holly Gibbs It"
    // came from "Holly Gibbs. It is ..." running together.
    if (words.some((w) => STOPWORD.has(w.toLowerCase()))) return null;
    // Overlap with the school's own name means it is the school, not a head.
    if (words.some((w) => schoolWords.has(w.toLowerCase()))) return null;

    return name;
  };

  // An honorific is the strongest signal, so try those forms first.
  const ordered = [
    new RegExp(`${TITLE}[\\s:,\\-–—]+(${WITH_HONORIFIC})`, "g"),
    new RegExp(`(${WITH_HONORIFIC})[\\s,\\-–—]+(?:is\\s+(?:our|the)\\s+)?${TITLE}\\b`, "g"),
    new RegExp(`${TITLE}[\\s:,\\-–—]+(${NAME_CORE})`, "g"),
    new RegExp(`(${NAME_CORE})[\\s,\\-–—]+${TITLE}\\b`, "g"),
  ];

  for (const re of ordered) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const ok = accept(m[1] ?? "");
      if (ok) return { text: ok, source: sourceUrl };
    }
  }
  return null;
}

/**
 * Something specific and real about the school — a milestone, an
 * accreditation, a stated value. Generic marketing copy is skipped, because
 * "we strive for excellence" is not a reason to want to work somewhere.
 */
const SCHOOL_HOOK_PATTERNS: { re: RegExp; shape: (m: RegExpExecArray) => string }[] = [
  {
    // "the first school in Johor Bahru to earn IPC accreditation"
    // Keywords accept either case (headings are capitalised), but the captured
    // place name must stay [A-Z] so it is a proper noun, not any word.
    re: /\b(?:[Tt]he\s+)?[Ff]irst\s+[Ss]chool\s+in\s+([A-Z][\w\s'’-]{2,30})\s+to\s+([a-z][\w\s'’-]{5,60})/,
    shape: (m) => `became the first school in ${m[1]!.trim()} to ${m[2]!.trim()}`,
  },
  {
    // "accredited by CIS and NEASC", "accredited by the IB Organisation to
    // offer the Primary Years Programme" — the body may start with "the".
    re: /\b[Aa]ccredited\s+by\s+((?:the\s+)?[A-Z][A-Za-z&.'’\- ]{1,60}(?:\s+and\s+(?:the\s+)?[A-Z][A-Za-z&.'’\- ]{1,40})?(?:\s+to\s+offer\s+[A-Za-z&.'’\- ]{1,50})?)/,
    shape: (m) => `is accredited by ${m[1]!.trim().replace(/\s+/g, " ")}`,
  },
  {
    // "an IB World School offering all three programmes"
    re: /\b(?:is\s+)?an?\s+(IB\s+World\s+School[\w\s,'’-]{0,60})/,
    shape: (m) => `is ${m[1]!.trim()}`,
  },
  {
    // "founded in 1974"
    re: /\b(?:founded|established|opened)\s+in\s+((?:18|19|20)\d{2})\b/,
    shape: (m) => `has been going since ${m[1]}`,
  },

  /*
   * Directory blurbs, which read nothing like a school's own marketing.
   *
   * The patterns above were written for website prose — awards, accreditation
   * announcements, founding stories. The Teach Away listing carries a short
   * factual paragraph instead: "X is a private international college
   * preparatory school that teaches students from...". 39% of schools have one
   * and only 6% yielded anything, which is the gap these close.
   */
  {
    // "is a private international college preparatory school"
    re: /\bis\s+an?\s+((?:private|independent|non-?profit|not-?for-?profit|co-?educational|day|boarding|bilingual|through-?train)[\w\s,'’-]{0,50}?school)\b/i,
    shape: (m) => `is ${indefinite(m[1]!)}`,
  },
  {
    // "teaches students from nursery through grade 13" / "from age 3 to 18"
    re: /\b(?:teaches|educates|serves|caters\s+for)\s+(?:students?|pupils?|children)\s+((?:from|aged?)\s+[\w\s.'’-]{4,45}?(?:to|through|-|–)\s*[\w\s.'’-]{2,25}?)(?:[.,;]|\s+(?:and|with|in)\b)/i,
    shape: (m) => `teaches students ${m[1]!.trim().replace(/\s+/g, " ")}`,
  },
  {
    // "a college preparatory school", stated on its own.
    re: /\b(college\s+preparatory)\b/i,
    shape: () => "is a college preparatory school",
  },
];

/** "private school" -> "a private school"; "IB World School" -> "an IB…". */
function indefinite(phrase: string): string {
  const p = phrase.trim().replace(/\s+/g, " ").toLowerCase();
  return `${/^[aeiou]/.test(p) ? "an" : "a"} ${p}`;
}

/**
 * Cut a captured phrase back to a clean ending.
 *
 * A capped character class stops mid-word — "accredited to offer the Primary
 * Yea" — which would be embarrassing in a real email. Trim to the last whole
 * word and drop any dangling connective.
 */
function tidy(phrase: string, max = 90): string {
  let out = phrase.replace(/\s+/g, " ").trim();
  if (out.length > max) {
    out = out.slice(0, max);
    const cut = out.lastIndexOf(" ");
    if (cut > 20) out = out.slice(0, cut);
  }
  return out
    .replace(/[,;:.\s]+$/, "")
    .replace(/\s+(?:and|or|the|a|an|of|to|for|with|in|on|at|that|which|who)$/i, "")
    .trim();
}

export function findSchoolHook(html: string, sourceUrl: string): Hook | null {
  const text = htmlToText(html).slice(0, 200_000).replace(/\s+/g, " ");
  for (const p of SCHOOL_HOOK_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const out = tidy(p.shape(m));
    // Too short to be a real compliment; too long to read naturally.
    if (out.length < 15 || out.length > 110) continue;
    return { text: out, source: sourceUrl };
  }
  return null;
}

/**
 * Something specific about their PE or sport provision. Needs to be concrete
 * enough to say back to them without sounding generic.
 */
const PE_HOOK_PATTERNS: { re: RegExp; shape: (m: RegExpExecArray) => string }[] = [
  {
    // Facilities are the most concrete thing a school publishes.
    re: /\b(?:an?\s+|our\s+)?((?:Olympic[\s-]size\s+|indoor\s+|outdoor\s+|heated\s+|25[\s-]?metre\s+|50[\s-]?metre\s+)?(?:swimming\s+pool|sports\s+hall|sports\s+complex|athletics\s+track|astro\s*turf|all[\s-]weather\s+pitch|fitness\s+(?:centre|center|suite)|gymnasium|dance\s+studio|climbing\s+wall|tennis\s+courts?|multi[\s-]purpose\s+(?:hall|courts?)))\b/i,
    shape: (m) => `the ${m[1]!.toLowerCase().trim()}`,
  },
  {
    // Competitive programme.
    re: /\b(?:compete|competes|competing|participate[sd]?)\s+in\s+((?:the\s+)?[A-Z][\w\s&'’-]{3,50}(?:League|Games|Championships?|Conference|Tournament))/,
    shape: (m) => `competing in ${m[1]!.trim()}`,
  },
  {
    // Named sports on offer.
    re: /\b(?:sports?\s+(?:on\s+offer|offered|include[sd]?|programme\s+includes?)|we\s+offer)\s*:?\s*([a-zA-Z][\w\s,&'’-]{10,90})/i,
    shape: (m) => `a sports programme covering ${m[1]!.trim().replace(/\s+/g, " ").replace(/[.,;]$/, "")}`,
  },
  {
    // Co-curricular breadth, which the example email leans on.
    re: /\b((?:co[\s-]?curricular|extra[\s-]?curricular)\s+(?:programme|program|activities|sport)[\w\s,'’-]{0,60})/i,
    shape: (m) => `your ${m[1]!.toLowerCase().trim().replace(/\s+/g, " ")}`,
  },

  /*
   * The rest come from reading what PE adverts actually say. The patterns
   * above were written for school websites, which describe facilities; an
   * advert describes the programme it is hiring into, and says so in a handful
   * of recurring shapes. Adding these took the PE fact from 3 of 31 open roles
   * to a usable share of them.
   */
  {
    // "programs in sports such as gymnastics, martial arts, basketball and cricket"
    re: /\bsports?\s+(?:such\s+as|including|like)\s+([a-zA-Z][\w\s,&'’-]{10,90})/i,
    shape: (m) => `your sports programme covering ${m[1]!.trim().replace(/\s+/g, " ").replace(/[.,;]$/, "")}`,
  },
  {
    // "the volleyball performance pathway from upper primary through to Sixth Form"
    re: /\b(?:the\s+)?([a-z]{4,14})\s+(?:performance\s+)?pathway\b/i,
    shape: (m) => `the ${m[1]!.toLowerCase()} performance pathway you are building`,
  },
  {
    // "established competition pathways", "competitive sports programmes"
    re: /\b((?:established|strong|clear)\s+competition\s+pathways|competitive\s+sports?\s+(?:programmes?|programs?))\b/i,
    shape: (m) => `the ${m[1]!.toLowerCase()} you have put in place`,
  },
  {
    // "a high-calibre, specialist-led sports programme that drives participation"
    re: /\b((?:specialist[\s-]led|high[\s-]calibre|high[\s-]caliber|high[\s-]performance)\s+sports?\s+programme?s?)\b/i,
    shape: (m) => `your ${m[1]!.toLowerCase().replace(/\s+/g, " ")}`,
  },
  {
    // A department with real structure: someone leads sport full time.
    re: /\b(Director\s+of\s+Sports?|Head\s+of\s+(?:Sports?|PE|Physical\s+Education)|Athletics\s+Director|Head\s+of\s+Athletics)\b/,
    shape: (m) => `that sport is led properly, with a ${m[1]!.replace(/\s+/g, " ")} in post`,
  },
  {
    // A named sport sitting in the curriculum and beyond it — the Aga Khan
    // Academy offers "swimming both as part of the MYP Physical and Health
    // Education lessons and after school".
    re: /\b(?:offers?|offering|provide[sd]?|run(?:s|ning)?|teach(?:es|ing)?|coach(?:es|ing)?)\s+(?:[\w\s]{0,24}?\s)?(swimming|basketball|football|soccer|rugby|netball|cricket|tennis|volleyball|badminton|hockey|athletics|gymnastics|dance|martial\s+arts)\b(?=[^.]{0,80}\b(?:after[\s-]school|co[\s-]?curricular|lessons?|curriculum|programme|department)\b)/i,
    shape: (m) => `that ${m[1]!.toLowerCase()} runs right through the curriculum and beyond the timetable`,
  },
];

/**
 * Phrases too vague to be worth saying back to a school. "Your co-curricular
 * activities" could be written about anyone, and reads as a form letter —
 * which defeats the point of a personalised email.
 */
const TOO_GENERIC =
  /^(?:your\s+|a\s+sports\s+programme\s+covering\s+)?(?:co-?curricular|extra-?curricular)\s+(?:activities|programme|program|sport)$/i;

/**
 * A hook must name something — a sport, a facility, a competition. Without a
 * concrete noun it is a compliment that fits any school.
 */
/*
 * A named post or a structured pathway counts as concrete too. It is a
 * specific thing this school has that many do not, and it is the thing a PE
 * candidate actually cares about — "there is a Director of Sport in post" says
 * more about a department than another mention of a sports hall.
 */
const CONCRETE =
  /\b(?:pool|hall|complex|track|turf|pitch|court|courts|gym|gymnasium|studio|wall|centre|center|suite|league|games|championship|championships|conference|tournament|football|soccer|basketball|netball|rugby|cricket|tennis|volleyball|badminton|hockey|athletics|gymnastics|swimming|aquatics|rowing|golf|baseball|softball|dance|climbing|fitness|martial\s+arts|pathways?|Director\s+of\s+Sport|Head\s+of\s+PE|Athletics\s+Director|specialist[\s-]led)\b/i;

export function findPeHook(html: string, sourceUrl: string): Hook | null {
  const text = htmlToText(html).slice(0, 200_000).replace(/\s+/g, " ");
  for (const p of PE_HOOK_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const out = tidy(p.shape(m), 110);
    if (out.length < 12 || out.length > 120) continue;
    if (TOO_GENERIC.test(out)) continue;
    // Must name a sport, facility or competition to be worth saying.
    if (!CONCRETE.test(out)) continue;
    return { text: out, source: sourceUrl };
  }
  return null;
}
