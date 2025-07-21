import { scrapeAndSummarize } from "./services/smartScraper.js";
import fs from "fs";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node testScrape.js <url>");
  process.exit(1);
}

// Optional: load prior snapshot to diff
let previousText = "";
const SNAP_PATH = "./last-scrape.txt";
if (fs.existsSync(SNAP_PATH)) {
  previousText = fs.readFileSync(SNAP_PATH, "utf8");
}

const result = await scrapeAndSummarize({ url, previousText });

console.log("=== SUMMARY ===");
console.log(result.summary);
console.log("\n=== PRICES ===");
console.log(result.prices);
console.log("\n=== DIFF ===");
console.log(result.diff);

fs.writeFileSync(SNAP_PATH, result.cleanText, "utf8");
