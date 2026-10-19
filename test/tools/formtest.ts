import { scanSchool } from "../../src/enrich/careerscan.ts";
for (const site of ["https://www.dishs.tp.edu.tw/", "https://www.iss.sc/", "https://www.islkl.com/", "https://www.hia.com.tw/", "https://ise.ac.th/", "https://www.bisphuket.ac.th/", "https://www.berkeley.ac.th/", "https://www.panyaden.ac.th/", "https://www.tas.edu.tw/"]) {
  const r = await scanSchool(site);
  console.log(site.padEnd(34), r.form ? `${r.form.kind} | ${r.form.url} | on ${r.form.page}` : "(no form linked)");
}
