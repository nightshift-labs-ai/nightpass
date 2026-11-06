// Headless check of the live page: both contracts decoded from the preview indexer, nullifier checker works.
import { chromium } from "/home/agent/tools/pw/node_modules/playwright/index.mjs";
const url = process.argv[2] ?? "http://127.0.0.1:8766/live/";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(url); await p.waitForSelector("#status[data-ok]", { timeout: 30000 });
const res = await p.evaluate(() => ({ bi: [...document.querySelectorAll('[data-k="bi"]')].map((e) => +e.textContent),
  cr: [...document.querySelectorAll('[data-k="cr"]')].map((e) => +e.textContent),
  nf: document.querySelector("#c0")?.textContent.match(/nf ([0-9a-f]{64})/)?.[1] }));
await p.fill("#nf", res.nf ?? ""); await p.click("#chk"); res.ans = await p.textContent("#ans");
await p.fill("#nf", "ab".repeat(32)); await p.click("#chk"); res.ans2 = await p.textContent("#ans");
await p.screenshot({ path: process.argv[3] ?? "/tmp/punchcard-live.png", fullPage: true });
console.log(JSON.stringify({ ...res, errs })); await b.close();
const ok = res.bi.length === 2 && res.cr.every((x) => x >= 2) && /spent on contract A/.test(res.ans) && /not spent/.test(res.ans2) && !errs.length;
console.log(ok ? "LIVE TEST PASSED" : "LIVE TEST FAILED"); process.exit(ok ? 0 : 1);
