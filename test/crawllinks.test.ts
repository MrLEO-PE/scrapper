/**
 * Which link the site crawler reads first.
 *
 * The crawler has a small page budget per school, so the order it picks links
 * in decides what ends up in the sheet. The trap is the word "careers": at a
 * school it usually means the pupils' careers, and those pages match the
 * recruitment patterns exactly. Eighty-nine schools had a careers-and-
 * university-guidance page recorded as the place to apply for a job, each one
 * having also consumed the crawler's highest-priority slot.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreLink } from "../src/enrich/website.ts";

const scoreOf = (url: string, text = "") => scoreLink(url, text)?.score ?? 0;
const tagOf = (url: string, text = "") => scoreLink(url, text)?.tag;

test("a real vacancy page keeps the top priority", () => {
  for (const url of [
    "https://s.ac.th/careers/",
    "https://s.ac.th/vacancies",
    "https://s.ac.th/join-our-team",
    "https://s.ac.th/work-with-us",
    "https://s.ac.th/employment",
    "https://s.ac.th/current-vacancies",
  ]) {
    assert.equal(tagOf(url), "careers", url);
    assert.ok(scoreOf(url) >= 95, `${url} scored ${scoreOf(url)}`);
  }
});

test("a pupils' careers page is demoted and never tagged careers", () => {
  // Every one of these was recorded in the database as a school's careers page.
  for (const url of [
    "https://www.ycis-bj.com/en/academics/careers-and-university-guidance-office",
    "https://www.nexus.edu.sg/career-and-university-guidance/",
    "https://www.nordangliaeducation.com/academic-excellence/university-and-careers-counselling",
    "http://www.sunmarkedubai.com/learning/sixth-form/careers-counsellor/",
    "https://www.rism.ac.th/career-day-with-ris-alumni/",
    "https://ise.ac.th/academics/university-and-careers-suport/",
    "https://sisb.ac.th/pastoral-care-and-career-guidance-pccg/",
    "http://www.kellettschool.com/sixth-form/university-careers-guidance",
    "https://westminster.uz/career-centre",
    "https://www.rais.ac.th/support-services/college-placement-career-office/",
    "https://tcis.ac.th/academics/department/career-and-technical-education",
    "http://www.gemsfoundersschool-dubai.com/en/Curriculum/Student-Care-and-Support/Career-Education",
  ]) {
    assert.notEqual(tagOf(url), "careers", `${url} must not be tagged careers`);
    assert.ok(scoreOf(url) < 95, `${url} scored ${scoreOf(url)}`);
  }
});

test("a real vacancy page outranks a pupils' careers page", () => {
  assert.ok(
    scoreOf("https://s.ac.th/about/vacancies") >
      scoreOf("https://s.ac.th/academics/careers-and-university-guidance"),
  );
});

test("the anchor text gives it away when the URL does not", () => {
  // Some sites link the guidance page from an opaque URL.
  assert.notEqual(tagOf("https://s.ac.th/page/1421", "Careers and University Guidance"), "careers");
  assert.equal(tagOf("https://s.ac.th/page/1422", "Current vacancies"), "careers");
});
