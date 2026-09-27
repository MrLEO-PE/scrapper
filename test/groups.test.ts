/**
 * Which big group owns a school.
 *
 * Who owns a school is a fact about the job: a group runs a group pay scale, a
 * central HR desk that often recruits for every campus at once, and a transfer
 * route between countries.
 *
 * The distinction this file exists to hold is Cognia against Cognita. Cognia
 * is an accreditation agency and accredits schools owned by many different
 * companies; Cognita is an owner. One letter apart, opposite meanings, and
 * putting the first in this column would tell you a school is part of a chain
 * when it is not.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { schoolGroup } from "../src/export/groups.ts";

test("names the group a school belongs to", () => {
  assert.equal(schoolGroup("Northbridge International School Cambodia", "https://www.nordangliaeducation.com/nisc"), "Nord Anglia");
  assert.equal(schoolGroup("Dulwich College Beijing"), "Dulwich College International");
  assert.equal(schoolGroup("Harrow International School Bangkok"), "Harrow International");
  assert.equal(schoolGroup("Yew Chung International School of Beijing"), "Yew Chung / Yew Wah");
  assert.equal(schoolGroup("The Aga Khan Academy Hyderabad"), "Aga Khan Academies");
});

test("finds the group in the domain when the name hides it", () => {
  // Several groups are invisible in the school's own name.
  assert.equal(schoolGroup("The British School Yangon", "https://www.nordangliaeducation.com/bsy"), "Nord Anglia");
  assert.equal(schoolGroup("Some School", "https://www.ycis-bj.com"), "Yew Chung / Yew Wah");
});

test("Cognia is not a group, Cognita is", () => {
  // The whole point. Cognia accredits; it does not own.
  assert.equal(schoolGroup("A School Accredited By Cognia"), undefined);
  assert.equal(schoolGroup("Cognita Schools Asia"), "Cognita");
});

test("an independent school belongs to nothing", () => {
  assert.equal(schoolGroup("Ruamrudee International School", "https://www.rism.ac.th"), undefined);
  assert.equal(schoolGroup("Jakarta Intercultural School"), undefined);
  assert.equal(schoolGroup(""), undefined);
  assert.equal(schoolGroup(null, null), undefined);
});
