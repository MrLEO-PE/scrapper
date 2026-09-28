/**
 * Recognising that two records are one school.
 *
 * Every case here is a real pair from the database. The dangerous direction is
 * a wrong merge — two genuine schools fused with no way to tell afterwards —
 * so the tests that matter most are the ones asserting a merge does *not*
 * happen.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findMatch, preferred, sameSchool, type SchoolIdentity } from "../src/store/identity.ts";
import { schoolCore } from "../src/core/text.ts";

const school = (over: Partial<SchoolIdentity> & { schoolKey: string; name: string }): SchoolIdentity => ({
  country: null, city: null, website: null, origin: "job",
  ...over,
});

test("merges when a board gave no country and the directory did", () => {
  // Teach Away published this vacancy with no country at all.
  const fromJob = school({
    schoolKey: "shanghai-high-division",
    name: "Shanghai High School International Division",
    website: "https://www.shsid.org",
  });
  const fromDirectory = school({
    schoolKey: "shanghai-high-division|china",
    name: "Shanghai High School International Division",
    country: "China", website: "https://www.shsid.org", origin: "directory",
  });
  assert.equal(sameSchool(fromJob, fromDirectory), "same name, country unknown");
});

test("merges a name/country disagreement when the website settles it", () => {
  // Life Plus was filed under the UAE from a job board and under China from
  // the directory. yhischina.com is the same site, so it is one school — and
  // it was ranked fifth in the UAE because of the split.
  const fromJob = school({
    schoolKey: "life-plus|united-arab-emirates", name: "Life Plus",
    country: "United Arab Emirates", website: "https://www.yhischina.com",
  });
  const fromDirectory = school({
    schoolKey: "life-plus|china", name: "Life Plus",
    country: "China", website: "https://www.yhischina.com", origin: "directory",
  });
  assert.equal(sameSchool(fromJob, fromDirectory), "same name and website");
  // And the directory's country is the one to keep.
  assert.equal(preferred(fromJob, fromDirectory).country, "China");
});

test("keeps two schools of the same name in different countries apart", () => {
  // Lincoln School exists in both Nepal and Costa Rica. Same core name, no
  // shared website — fusing these would be a silent, unrecoverable error.
  const nepal = school({ schoolKey: "lincoln|nepal", name: "Lincoln School", country: "Nepal", origin: "directory" });
  const costaRica = school({
    schoolKey: "lincoln|costa-rica", name: "Lincoln School", country: "Costa Rica", origin: "directory",
  });
  assert.equal(sameSchool(nepal, costaRica), undefined);
});

test("merges one school written two ways on its own domain", () => {
  const long = school({
    schoolKey: "united-world-south-east-asia|singapore",
    name: "United World College of South East Asia",
    country: "Singapore", website: "https://www.uwcsea.edu.sg",
  });
  const short = school({
    schoolKey: "uwc-south-east-asia|singapore", name: "UWC South East Asia",
    country: "Singapore", website: "https://uwcsea.edu.sg", origin: "directory",
  });
  assert.equal(sameSchool(long, short, 2), "same website");
});

test("never merges schools sharing an applicant tracking domain", () => {
  // Thirteen different BASIS schools publish on one jobs domain. A busy host
  // identifies nothing.
  const shenzhen = school({
    schoolKey: "basis-shenzhen|china", name: "BASIS International School Shenzhen",
    country: "China", website: "https://jobs.basisinternationalschools.com",
  });
  const guangzhou = school({
    schoolKey: "basis-guangzhou|china", name: "BASIS International School Guangzhou",
    country: "China", website: "https://jobs.basisinternationalschools.com",
  });
  assert.equal(sameSchool(shenzhen, guangzhou, 13), undefined);
});

test("different cities on one domain are different campuses", () => {
  // Three "Abroad International School" records share abroadschools.jp.
  const tokyo = school({
    schoolKey: "abroad-tokyo|japan", name: "Abroad International School",
    country: "Japan", city: "Tokyo", website: "https://abroadschools.jp",
  });
  const osaka = school({
    schoolKey: "abroad-osaka|japan", name: "Abroad International School",
    country: "Japan", city: "Osaka", website: "https://abroadschools.jp",
  });
  assert.equal(sameSchool(tokyo, osaka, 3), undefined);
});

test("a nationality is part of a school's identity, not noise", () => {
  // "American" and "British" International School Vietnam are different
  // schools. American, International and School were once all stripped as
  // generic, leaving both as "vietnam" — a Wikidata lookup matched the
  // American school to the British school's domain on exactly that, and this
  // file used to carry a guard against place-only names to contain it.
  //
  // The words are no longer stripped, so the two names simply differ and the
  // guard is not reached. Which is the better place to fix it: the key is the
  // primary key, so a collision there did not produce a duplicate to catch —
  // it overwrote one school with the other.
  const american = school({
    schoolKey: "american-international-school-vietnam|vietnam",
    name: "American International School Vietnam", country: "Vietnam",
  });
  const british = school({
    schoolKey: "british-international-school-vietnam|vietnam",
    name: "British International School Vietnam",
    country: "Vietnam", origin: "directory",
  });
  assert.equal(sameSchool(american, british), undefined);

  // A shared website still settles it, on the website alone now rather than
  // on names that only looked alike once both were stripped to "vietnam".
  assert.equal(
    sameSchool(
      { ...american, website: "https://bisvietnam.com" },
      { ...british, website: "https://www.bisvietnam.com" },
    ),
    "same website",
  );
});

test("the same school written two ways still agrees", () => {
  // The reason structural words are stripped at all. This must keep working.
  assert.ok(
    sameSchool(
      school({ name: "The British School of Beijing", country: "China" }),
      school({ schoolKey: "other", name: "British School Beijing", country: "China" }),
    ),
  );
});

test("a name that reduces to nothing but its own city is not an identity", () => {
  // "Harare International School" -> "harare".
  const a = school({
    schoolKey: "harare|zimbabwe", name: "Harare International School",
    country: "Zimbabwe", city: "Harare",
  });
  const b = school({
    schoolKey: "harare-2|zimbabwe", name: "Harare Academy International School",
    country: "Zimbabwe", city: "Harare", origin: "directory",
  });
  assert.equal(sameSchool(a, b), undefined);
});

test("a distinctive single-word name still matches normally", () => {
  // The guard must only fire on place names, or it would break every school
  // whose identity genuinely is one word.
  const a = school({ schoolKey: "craighouse", name: "Craighouse School", city: "Lo Barnechea" });
  const b = school({
    schoolKey: "craighouse|chile", name: "Craighouse School",
    country: "Chile", city: "Lo Barnechea", origin: "directory",
  });
  assert.equal(sameSchool(a, b), "same name, country unknown");
});

test("a record never matches itself", () => {
  const s = school({ schoolKey: "k|china", name: "A School", country: "China" });
  assert.equal(sameSchool(s, s), undefined);
});

test("finds the matching row among many", () => {
  const candidate = school({ schoolKey: "life-plus", name: "Life Plus", website: "https://yhischina.com" });
  const rows = [
    school({ schoolKey: "other|china", name: "Another School", country: "China" }),
    school({ schoolKey: "life-plus|china", name: "Life Plus", country: "China", origin: "directory" }),
  ];
  const hit = findMatch(candidate, rows);
  assert.equal(hit?.existing.schoolKey, "life-plus|china");
});

test("a nationality plus a city is an identity, not a city", () => {
  // Seventy-four stored schools had a key that was nothing but a place. Since
  // the key is the primary key, two of them in one city did not collide into
  // a duplicate — the second overwrote the first. Three of Vietnam's largest
  // schools could not be added at all: their key was already someone else's.
  const core = (n: string) => schoolCore(n);
  assert.notEqual(core("British International School Ho Chi Minh City"), core("International School Ho Chi Minh City"));
  assert.notEqual(core("The British School Manila"), core("American School Manila"));
  assert.notEqual(core("Doha British School"), core("American International School of Doha"));
  assert.notEqual(core("Taipei American School"), core("Taipei European School"));

  // And none of them reduces to the bare city any more.
  for (const n of ["Hong Kong International School", "Taipei American School", "The British School Yangon"]) {
    assert.ok(core(n).split("-").length > 1, `${n} -> ${core(n)}`);
  }
});
