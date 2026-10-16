import { scanSchool } from "../../src/enrich/careerscan.ts";
const cases: [string, string, string][] = [
  ["ISE", "https://ise.ac.th/", "hr@ise.ac.th"],
  ["Beijing Royal", "https://www.brs.edu.cn/en/", "brshr@brs.edu.cn"],
  ["Utahloy GZ", "https://utahloy.cn/gz/", "recruitment@uisgz.org"],
  ["Hsinchu American", "https://has.hc.edu.tw/", "anti.lin@has.hc.edu.tw"],
  ["British School Manila", "https://www.britishschoolmanila.org/", "eabawag@britishschoolmanila.org"],
  ["SPH", "https://sph.edu/our-schools/pluit-village", "expat.recruitment@sph.ac.id"],
  ["Aster", "https://aster.ac.th/", "recruitment@aster.ac.th"],
  ["ASB Green Valley", "https://asbgv.ac.th/", "asbgv-recruitment@asb.ac.th"],
  ["DBS Denla", "https://www.dbsbangkok.ac.th/", "hrm@dbsbangkok.ac.th"],
  ["RIS Swiss", "https://ris-swiss-section.org/", "supit.k@ris-swiss-section.org"],
  ["Renaissance", "https://renaissance.edu.vn/", "vacancies@renaissance.edu.vn"],
  ["BIS Phuket", "https://www.bisphuket.ac.th/", "sirirats@bisphuket.ac.th"],
  ["Vinschool portal", "https://tuyendung.vinschool.edu.vn/", "recruitment@vinschool.edu.vn"],
  ["NEG Berkeley", "https://www.berkeley.ac.th/", "(none)"],
  ["NEG Panyaden", "https://www.panyaden.ac.th/", "(none)"],
  ["NEG TAAS", "https://www.taas.tw/", "(none)"],
  ["NEG Garden BKK", "https://gardenbangkok.com/", "(none)"],
  ["NEG Wells", "https://wells.ac.th/", "(none)"],
];
for (const [name, site, want] of cases) {
  const r = await scanSchool(site);
  const got = r.best ? `${r.best.email} [${r.best.kind} ${r.best.score}]` : "(none)";
  const ok = want === "(none)" ? !r.best : r.best?.email === want || r.others.some((o) => o.email === want);
  console.log(`${ok ? "OK  " : "MISS"} ${name.padEnd(22)} want ${want.padEnd(34)} got ${got}${r.others.length ? "  +" + r.others.map((o) => o.email).join(",") : ""}  pages:${r.pagesRead}`);
}
