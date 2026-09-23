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
