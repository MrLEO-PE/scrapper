/**
 * Principals' names read off school websites. About a third of the 920 on file
 * carried page furniture or were not names at all, and letters greeted people
 * by them, so every case here is a real one from the database.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanPersonName } from "../src/enrich/personname.ts";

const same = (raw: string, expected: string | null, school = "") => assert.equal(cleanPersonName(raw, school), expected, raw);

test("menu words before a name are trimmed", () => {
  same("Leadership Dale Bennett", "Dale Bennett");
  same("LEADERSHIP David Tansey", "David Tansey");
  same("Administration Yvan Zebroff", "Yvan Zebroff");
  same("Meet Mrs Louise Hart", "Mrs Louise Hart");
});

test("tags after a name are trimmed", () => {
  same("Ms Shelley Swift Profile", "Ms Shelley Swift");
  same("Mr. Ben Raybould Choosing", "Mr. Ben Raybould");
  same("Ms Andrea Higgins Ms", "Ms Andrea Higgins");
  same("Mr Damien Hehir YCIS", "Mr Damien Hehir");
  same("Dr Kannika Leelapanyalert Thai", "Dr Kannika Leelapanyalert");
  same("Ann Haydon MBE", "Ann Haydon");
  same("Phalla Chen HR", "Phalla Chen");
  same("Dr. Howard Menand IV", "Dr. Howard Menand");
  same("CHRISTOPHE GALIAN Founder", "Christophe Galian");
});

test("things that are not a person are refused", () => {
  for (const junk of [
    "Dear Colleagues", "Dear Visitors", "Dear RAIS Family", "What Sets Us", "What Makes Us", "Why BIS",
    "PEACE BE UPON", "Membantu Kepala Sekolah", "Us Facilities Accreditation", "TLCH Cultural Immersion",
    "Leadership Position", "Position Summary", "Role Summary", "Study Room", "Quick Links", "Join Us",
    "View Profile", "Visit Us", "Why Families Choose", "INQUIRE NOW",
  ]) same(junk, null);
});

test("a name set in capitals is a name, an acronym beside words is not", () => {
  same("LEIGH O’HARA", "Leigh O’Hara");
  same("CHANDRA MCGOWAN", "Chandra McGowan");
  // Three words and no honorific: a real name, but not distinguishable from a name plus page text.
  same("NI LAR WIN", null);
  same("Dr. RANDY LEE BELL", "Dr. Randy Lee Bell");
  same("Dr. WANG Guangfa", "Dr. Wang Guangfa");
  same("Dr. Shivananda CS", "Dr. Shivananda CS");
});

test("a three-word name with no honorific cannot be told from a name plus page text, so it is not used", () => {
  same("Susan Kirby Finance", "Susan Kirby");
  same("Jessie Kim Spark", "Jessie Kim");
  same("Ian Brett Windsor", null);
  // With an honorific the shape is unambiguous.
  same("Mr. Michael David Ogden", "Mr. Michael David Ogden");
});

test("ordinary names come through untouched", () => {
  for (const ok of ["Tim Aviss", "Ms Shelley Pyman", "Dr. Michael Boots", "Christian-Yves Michelon", "Mrs. Samina Rahman", "Mr Chris Parfitt"]) same(ok, ok);
});

test("the school's own name is not its head's", () => {
  same("Harrow Wells", null, "Harrow International School Wells");
  assert.equal(cleanPersonName("", "x"), null);
  assert.equal(cleanPersonName(null, "x"), null);
});
