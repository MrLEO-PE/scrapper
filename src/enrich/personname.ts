/**
 * Is this a person's name, and what is it without the page furniture around it?
 *
 * A name read off a school's website arrives with its surroundings attached:
 * "Leadership Dale Bennett" (a menu heading above the name), "Ms Shelley Swift
 * Profile" (the link under it), "Susan Kirby Finance" (the next line), and
 * sometimes no name at all — "Dear Colleagues", "What Sets Us", "Why BIS",
 * "Membantu Kepala Sekolah". Of the 920 principals on file, roughly a third
 * were wrong in one of these ways, and letters greeted people by them.
 *
 * A wrong name in a greeting is worse than none. So the policy is conservative:
 *   - trim the furniture from the edges of what is clearly a name;
 *   - a name is only trusted when its shape is unambiguous — "First Last", or
 *     an honorific and one or two name words. "First Middle Last" with no
 *     honorific cannot be told apart from a name with a word of page text on
 *     the end, so it is not used;
 *   - where nothing trustworthy is left, return nothing, and the letter says
 *     "Dear Principal".
 */

const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof|professor|rev|sir|dame)\.?$/i;
const SUFFIX = /^(?:jr|sr|ii|iii|iv|mbe|obe|cbe|oam|phd|edd)\.?$/i;

/**
 * Words that sit beside a name on a page without being part of it. Stripped
 * from either end; if one is left in the middle it is not a name.
 */
const EDGE = new Set([
  "leadership", "meet", "dear", "administration", "management", "our", "the", "message", "welcome",
  "profile", "about", "principal", "head", "headmaster", "headmistress", "director", "executive",
  "senior", "school", "sekolah", "membantu", "kepala", "general", "us", "team", "staff", "contact",
  "english", "high", "choosing", "thai", "read", "more", "here", "from", "of", "and", "mrs", "mr", "ms",
  "view", "leads", "warmly", "sincerely", "regards", "former", "early", "finance", "engage", "spark",
  "titles", "preschool", "with", "for", "to", "at", "in", "on", "by", "join", "visit", "discover",
  "download", "learn", "click", "share", "follow", "home", "menu", "back", "next", "quick", "links",
  "connect", "experience", "desk", "photos", "bio", "close", "careers", "improvement", "emeritus",
  "personal", "founder", "owner", "ceo", "chairman", "president", "chair",
]);

/** Words that mean it is not a person, wherever they appear. */
const NOT_A_NAME = new Set([
  "colleagues", "visitors", "family", "families", "parents", "students", "pupils", "friends", "what",
  "why", "who", "how", "when", "where", "sets", "makes", "make", "we", "be", "upon", "peace", "profil",
  "district", "college", "academy", "international", "campus", "vision", "mission", "values", "news",
  "blog", "apply", "admissions", "learning", "board", "governors", "trust", "office", "deputy",
  "assistant", "vice", "associate", "acting", "interim", "facilities", "accreditation", "cultural",
  "immersion", "life", "story", "history", "inquire", "inquiry", "now", "choose", "thailand",
  "powerschool", "coffee", "mornings", "meals", "protection", "procedures", "policy", "policies",
  "marketing", "academic", "administrative", "operations", "bursar", "counsellor", "primary",
  "secondary", "elementary", "kindergarten", "years", "current", "new", "previous", "tour", "book",
  "call", "email", "phone", "search", "top", "enquire", "subscribe", "tweet", "brochure", "faq",
  "calendar", "events", "gallery", "alumni", "donate", "give", "support", "programmes", "programs",
  "position", "role", "summary", "special", "collections", "study", "room", "para", "library",
  "department", "details", "description", "requirements", "qualifications", "responsibilities",
  ...EDGE,
]);

const isInitial = (t: string): boolean => /^[A-Z]{1,2}\.?$/.test(t);
/** "BIS", "YCIS", "ECC": three or more capitals is an acronym, or a shouted name. */
const isShouted = (t: string): boolean => /^[A-Z]{3,}$/.test(t.replace(/[.'’]/g, ""));
const looksLikeNamePart = (t: string): boolean => isInitial(t) || (/^[A-Z][a-zA-Z'’\-]{1,20}$/.test(t) && !isShouted(t));

/** "O’HARA" -> "O’Hara", "MCGOWAN" -> "McGowan", "WANG" -> "Wang". */
function unshout(t: string): string {
  const s = t.charAt(0) + t.slice(1).toLowerCase();
  return s
    .replace(/^(Mc)([a-z])/, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/^(O['’])([a-z])/, (_, a: string, b: string) => a + b.toUpperCase());
}

export function cleanPersonName(raw: string | null | undefined, schoolName = ""): string | null {
  if (!raw) return null;
  let tokens = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!tokens.length) return null;

  const key = (t: string) => t.toLowerCase().replace(/[.,:;]+$/g, "");
  const isEdge = (t: string) => EDGE.has(key(t)) && !HONORIFIC.test(t);

  // Furniture before the name: "Leadership Dale Bennett", "Meet Mrs Louise".
  while (tokens.length && isEdge(tokens[0]!)) tokens.shift();
  let honorific: string | null = null;
  if (tokens[0] && HONORIFIC.test(tokens[0])) honorific = tokens.shift()!;
  while (tokens.length && isEdge(tokens[0]!)) tokens.shift();

  // Whether the whole name is shouted ("RANDY LEE BELL"): then a capitalised
  // last word is a surname, not a tag.
  const allShouted = () => tokens.length >= 2 && tokens.every((t) => isShouted(t) || isInitial(t));

  // Furniture, suffixes and tags after it: "Profile", "Choosing", "MBE", "YCIS", "HR".
  for (;;) {
    const last = tokens[tokens.length - 1];
    if (!last) break;
    const tag =
      EDGE.has(key(last)) ||
      SUFFIX.test(last) ||
      HONORIFIC.test(last) ||
      (tokens.length >= 3 && !allShouted() && (isShouted(last) || /^[A-Z]{2}$/.test(last)));
    if (tag) tokens.pop();
    else break;
  }

  if (tokens.length < 2 || tokens.length > 3) return null;
  // First Middle Last, with nothing to say it is a person, cannot be told from a
  // name followed by a word of page text ("Susan Kirby Finance"). Not used.
  if (tokens.length === 3 && !honorific) return null;

  /*
   * A name set in capitals — "LEIGH O’HARA", or the surname convention in
   * "Dr. WANG Guangfa" — is a name, but a lone acronym beside ordinary words
   * ("TLCH Cultural Immersion") is not. Capitals are only unshouted when the
   * whole name is shouted, or an honorific says a person is being named.
   */
  if (tokens.some(isShouted) && (honorific || allShouted())) {
    tokens = tokens.map((t) => (isShouted(t) ? unshout(t) : t));
  }
  if (!tokens.every(looksLikeNamePart)) return null;
  if (tokens.some((t) => NOT_A_NAME.has(key(t)))) return null;

  // The school's own name is not its head's.
  const schoolWords = new Set(schoolName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
  if (tokens.some((t) => schoolWords.has(key(t)))) return null;

  return [honorific, ...tokens].filter(Boolean).join(" ");
}
