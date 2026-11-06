// Record the live chain view (/live/) with scripted scrolling + a nullifier check → WebM (for the pitch video).
import { chromium } from "/home/agent/tools/pw/node_modules/playwright/index.mjs";
import fs from "node:fs";
const [url, outDir] = process.argv.slice(2); fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
const p = await ctx.newPage(); await p.goto(url); await p.waitForSelector("#status[data-ok]", { timeout: 30000 });
const w = (ms) => p.waitForTimeout(ms);
const scroll = (y) => p.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y);
const nf = await p.evaluate(() => document.querySelector("#c0").textContent.match(/nf ([0-9a-f]{64})/)[1]);
await w(3500); await scroll(330); await w(3000);
await scroll(600); await w(1000); await p.click("#nf"); await p.keyboard.type(nf, { delay: 4 }); await p.click("#chk"); await w(2500);
await scroll(2000); await w(3200);
await ctx.close(); await b.close();
