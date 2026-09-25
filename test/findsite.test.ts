/**
 * Working out a school's website from its name.
 *
 * Guessing an address is only acceptable because every guess is checked
 * against the page that answers. A wrong address is worse than none: it yields
 * a confident careers email, package and pay figure for a different school,
 * and nothing downstream looks any less certain than the truth. So these tests
 * are mostly about refusing.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  candidateHosts,
  distinctiveWords,
  pageIsSchool,
  siteFromEmail,
} from "../src/enrich/findsite.ts";

test("a nationality is not a distinctive name", () => {
  // The false positive that prompted this rule: "Canadian International School
  // of Singapore" guessed canadian.edu.sg, which is Canadian Education College
  // — a language school. Both words appear on both sites.
  assert.deepEqual(distinctiveWords("Canadian International School of Singapore"), []);
  assert.deepEqual(candidateHosts("Canadian International School of Singapore", "Singapore"), []);

  for (const bland of [
    "American International School",
    "The British School",
    "Western Academy",
    "New City International College",
  ]) {
    assert.deepEqual(candidateHosts(bland, "Thailand"), [], `${bland} is not guessable`);
  }
});

test("a real name yields candidates on the country's school domains", () => {
  const hosts = candidateHosts("Tenby Setia Eco Park International", "Malaysia");
  assert.ok(hosts.includes("tenby.edu.my"), `expected tenby.edu.my in ${hosts.join(", ")}`);
  assert.ok(hosts.every((h) => /\.(edu\.my|com|com\.my)$/.test(h)));
});

test("builds the acronym schools actually use", () => {
  // Yangon International School really is yis.edu.mm.
  assert.ok(candidateHosts("Yangon International School", "Myanmar").includes("yis.edu.mm"));
});

test("declines a country it has no domain conventions for", () => {
  assert.deepEqual(candidateHosts("Marshall Islands Academy", "Marshall Islands"), []);
});

test("accepts a page that is recognisably the school", () => {
  const page = `<html><title>Tenby Setia Eco Park</title><body>
    Welcome to Tenby Schools Setia Eco Park. Our campus serves students from
    the Eco Park area with a British curriculum. Admissions are open.</body></html>`;
  assert.equal(pageIsSchool(page, "Tenby Setia Eco Park International"), true);
});

test("rejects a school page belonging to a different school", () => {
  // Exactly the canadian.edu.sg case, written out.
  const wrong = `<html><title>Canadian Education College</title><body>
    An English language school in Singapore for adult learners. Our students
    come from across Asia. Admissions open all year.</body></html>`;
  assert.equal(pageIsSchool(wrong, "Canadian International School of Singapore"), false);
});

test("rejects a parked domain or a page that is not a school", () => {
  for (const notASchool of [
    "<html><body>This domain is for sale. Buy tenby.edu.my today.</body></html>",
    "<html><body>Tenby Setia Eco Park Property Developments — luxury homes</body></html>",
  ]) {
    assert.equal(pageIsSchool(notASchool, "Tenby Setia Eco Park International"), false);
  }
});

test("takes the website from an address we already hold", () => {
  assert.equal(siteFromEmail("careers@ucsischools.edu.my"), "https://ucsischools.edu.my");
  assert.equal(siteFromEmail("hr@yis-yangon.edu.mm"), "https://yis-yangon.edu.mm");
});

test("a free mailbox says nothing about the school", () => {
  for (const free of [
    "theschool@gmail.com", "admin@outlook.com", "info@yahoo.com",
    "hr@qq.com", "jobs@163.com", "office@hotmail.com",
  ]) {
    assert.equal(siteFromEmail(free), null, `${free} is a free mailbox`);
  }
  assert.equal(siteFromEmail(null), null);
  assert.equal(siteFromEmail("not-an-email"), null);
});

test("an applicant-tracking domain is not the school's website", () => {
  // careers@basisinternationalschools.com is real, but jobs.* is the ATS.
  assert.equal(siteFromEmail("apply@jobs.basisinternationalschools.com"), null);
  assert.equal(siteFromEmail("x@careers.someschool.com"), null);
});
