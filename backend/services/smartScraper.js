/**
 * Universal Smart Scraper + Summarizer
 * ------------------------------------
 * Now includes automatic saving of raw HTML content to Firestore/Storage
 */

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { diffLines } from "diff";
import crypto from "crypto";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios";
import * as cheerio from "cheerio";

const chromiumWithStealth = chromium.use(StealthPlugin());

// Try Gemini first (your existing client)
import { generateText as geminiGenerateText } from "../gemini/geminiClient.js";

// Storage utility for large content
import { savePageContent } from "./storage.js";  // <--- ADDED

// Optional OpenAI fallback (only if OPENAI_API_KEY set)
let openaiGenerateText = null;
async function maybeInitOpenAI() {
  if (!process.env.OPENAI_API_KEY) return;
  if (openaiGenerateText) return;
  const { OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  openaiGenerateText = async (prompt, { maxTokens = 400 } = {}) => {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3
    });
    return resp.choices?.[0]?.message?.content?.trim();
  };
}

/* ------------------------------------------------------------------ */
/* MAIN                                                               */
/* ------------------------------------------------------------------ */
async function fetchHtmlFallback(url) {
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return data;
}

/**
 * Main scraper + summary generator
 * @param {Object} params
 * @param {string} params.url - Target URL
 * @param {string} [params.previousText] - Optional previous snapshot text
 * @param {string} [params.userId] - Optional userId for storage
 * @param {string} [params.domain] - Optional domain for storage
 */
export async function scrapeAndSummarize({ url, previousText = "", userId, domain }) {
  const fetchedAt = Date.now();

  // 1. Render page & get HTML
  const { html, title } = await fetchRenderedHtml(url);

  // 2. Optionally save raw HTML content
  if (userId && domain) {
    try {
      await savePageContent(userId, domain, url, html);
    } catch (err) {
      console.error(`[SmartScraper] Failed to save page content for ${url}:`, err);
    }
  }

  // 3. Clean & extract key text
  const cleanText = extractMeaningfulText(html);

  // 4. Split into lines, clean, dedupe, drop junk
  const lines = cleanLines(cleanText);

  // 5. Extract price candidates
  const prices = extractPrices(lines);

  // 6. Diff vs previous version (optional)
  const diff = previousText ? buildDiff(previousText, cleanText) : { added: [], removed: [], changed: [] };

  // 7. Get AI summary
  const summary = await summarizeWithAI({
    url,
    title,
    lines,
    prices,
    diff
  });

  return {
    url,
    fetchedAt,
    title,
    rawHtml: html,
    cleanText,
    lines,
    prices,
    diff,
    summary
  };
}

/* ------------------------------------------------------------------ */
/* 1. Render + HTML                                                   */
/* ------------------------------------------------------------------ */
async function fetchRenderedHtml(url) {
  try {
    const browser = await chromiumWithStealth.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });

    await autoScroll(page); // optional if you have autoScroll function

    const html = await page.content();
    const title = await page.title();

    await browser.close();
    return { html, title };
  } catch (err) {
    console.warn("[SmartScraper] Playwright failed, using fallback:", err.message);
    const html = await fetchHtmlFallback(url);
    return { html, title: "<no title>" };
  }
}

async function autoScroll(page, step = 1000, delay = 250, maxScrolls = 20) {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(y => window.scrollBy(0, y), step);
    await page.waitForTimeout(delay);
  }
}

/* ------------------------------------------------------------------ */
/* (rest of your code remains same: extractMeaningfulText, cleanLines, etc.) */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 2. Clean & Extract                                                 */
/* ------------------------------------------------------------------ */
function extractMeaningfulText(html) {
  // Try Readability first
  try {
    const dom = new JSDOM(html, { url: "https://example.com/" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.textContent && article.textContent.trim().length > 100) {
      return article.textContent.trim();
    }
  } catch {
    // ignore readability failure
  }

  // Fallback: selective extraction
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Remove clearly noisy elements
  const removeSelectors = [
    "script",
    "style",
    "noscript",
    "svg",
    "iframe",
    "nav",
    "footer",
    "header",
    "form",
    "input",
    "button",
    "[role='navigation']",
    "[aria-hidden='true']",
    ".visually-hidden",
    ".sr-only"
  ];
  removeSelectors.forEach(sel => {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  });

  // Gather text from main containers in priority order
  const buckets = [];
  const selectors = ["main", "article", "section", "[role='main']"];
  for (const sel of selectors) {
    doc.querySelectorAll(sel).forEach(el => {
      const t = visibleText(el);
      if (t.trim()) buckets.push(t.trim());
    });
  }

  // If buckets empty, gather heading + paragraphs
  if (!buckets.length) {
    const bits = [];
    doc.querySelectorAll("h1,h2,h3,p,li").forEach(el => {
      const t = visibleText(el);
      if (t.trim()) bits.push(t.trim());
    });
    return bits.join("\n");
  }

  return buckets.join("\n");
}

function visibleText(el) {
  // crude visibility; JSDOM lacks layout so just take textContent
  return el.textContent || "";
}

/* ------------------------------------------------------------------ */
/* 3. Clean lines & dedupe                                            */
/* ------------------------------------------------------------------ */
function cleanLines(text) {
  // Normalize newlines
  const lines = text
    .replace(/\r+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const junkPatterns = [
    /^(sign\s?in|log\s?in|register|create account)$/i,
    /©\s?\d{4}/i,
    /cookies/i,
    /privacy/i,
    /terms/i,
    /^all rights reserved/i,
    /^skip to main/i,
    /^view or edit your browsing history/i,
    /^conditions of use/i,
    /^connect with us/i
  ];

  const seen = new Set();
  const out = [];

  for (const ln of lines) {
    if (ln.length < 4) continue;
    if (ln.split(" ").length < 2 && !hasPrice(ln)) continue; // drop ultra-short unless price
    if (junkPatterns.some(re => re.test(ln))) continue;

    // Collapse repeated inline whitespace
    const norm = ln.replace(/\s+/g, " ").trim();

    // Hash to dedupe
    const hash = sha(norm);
    if (seen.has(hash)) continue;
    seen.add(hash);

    out.push(norm);
  }
  return out;
}

function sha(str) {
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* 4. Extract prices                                                  */
/* ------------------------------------------------------------------ */
 const PRICE_RE = /(?:(₹|Rs\.?|INR|\$|USD|€|EUR|£|GBP|¥|JPY)\s?)([\d,]+(?:\.\d{1,2})?)/gi;

function extractPrices(lines) {
  const out = [];
  for (const ln of lines) {
    let m;
    while ((m = PRICE_RE.exec(ln)) !== null) {
      const [raw, curSymbol, numStr] = m;
      const value = parsePriceNumber(numStr);
      out.push({
        raw,
        value,
        currency: symbolToCurrency(curSymbol.trim())
      });
    }
  }
  return out;
}

function parsePriceNumber(str) {
  // drop commas; handle 1,299.00
  const num = Number(str.replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

function symbolToCurrency(sym) {
  const s = sym.toUpperCase();
  if (s === "₹" || s === "RS." || s === "RS" || s === "INR") return "INR";
  if (s === "$" || s === "USD") return "USD";
  if (s === "€" || s === "EUR") return "EUR";
  if (s === "£" || s === "GBP") return "GBP";
  if (s === "¥" || s === "JPY") return "JPY";
  return s;
}

function hasPrice(str) {
  return PRICE_RE.test(str);
}

/* ------------------------------------------------------------------ */
/* 5. Diffing                                                         */
/* ------------------------------------------------------------------ */
function buildDiff(oldText, newText) {
  const parts = diffLines(oldText, newText);

  const added = [];
  const removed = [];
  const changed = [];

  let lastRemoved = null;

  for (const part of parts) {
    if (part.added) {
      const lines = cleanLines(part.value);
      if (lastRemoved) {
        // Pair removed->added as changed
        lines.forEach(l => changed.push({ from: lastRemoved, to: l }));
        lastRemoved = null;
      } else {
        lines.forEach(l => added.push(l));
      }
    } else if (part.removed) {
      const lines = cleanLines(part.value);
      // Hold to see if followed by added (change)
      lastRemoved = lines.join("\n");
      // If no following added, we'll push to removed after loop
      // But diffLines groups; simpler: push removed lines now
      lines.forEach(l => removed.push(l));
    }
  }

  return { added, removed, changed };
}

/* ------------------------------------------------------------------ */
/* 6. AI Summarization                                                */
/* ------------------------------------------------------------------ */
async function summarizeWithAI({ url, title, lines, prices, diff }) {
  // Prepare a compact context (limit total size)
  const maxLines = 120; // adjust as needed
  const shortLines = lines.slice(0, maxLines);

  const topPrices = prices.slice(0, 25); // top N price events

  const diffPreview = {
    added: diff.added.slice(0, 20),
    removed: diff.removed.slice(0, 20),
    changed: diff.changed.slice(0, 20)
  };

  const prompt = buildPrompt(url, title, shortLines, topPrices, diffPreview);

  // Try Gemini first
  try {
    const text = await geminiGenerateText(prompt, { temperature: 0.25, maxOutputTokens: 400 });
    if (text) return text;
  } catch (err) {
    console.warn("[SmartScraper] Gemini failed:", err.message);
  }

  // OpenAI fallback
  try {
    await maybeInitOpenAI();
    if (openaiGenerateText) {
      const text = await openaiGenerateText(prompt, { maxTokens: 350 });
      if (text) return text;
    }
  } catch (err) {
    console.warn("[SmartScraper] OpenAI fallback failed:", err.message);
  }

  // Heuristic fallback
  return heuristicSummary({ url, title, lines: shortLines, prices, diff });
}

function buildPrompt(url, title, lines, prices, diff) {
  const priceLines = prices
    .map(p => `- ${p.currency} ${p.value} (${p.raw})`)
    .join("\n");

  const diffLinesText = [
    "Added:",
    ...diff.added.map(l => `+ ${l}`),
    "Removed:",
    ...diff.removed.map(l => `- ${l}`),
    "Changed:",
    ...diff.changed.map(c => `* ${c.from} -> ${c.to}`)
  ].join("\n");

  return `
You are an analyst agent. Summarize the important user‑visible changes on a competitor webpage.

URL: ${url}
Title: ${title || "<no title>"}

Key extracted lines (top ${lines.length}):
${lines.join("\n")}

Detected prices:
${priceLines || "(none)"}

Diff summary:
${diffLinesText}

TASK:
1. Write 5‑8 short bullet points grouped under: Pricing, New Content, Content Changes, Other.
2. Ignore boilerplate (legal, nav, cookie).
3. Merge near‑duplicate lines; remove noise.
4. Be concise; < 200 words total.

Return Markdown.
  `.trim();
}

function heuristicSummary({ url, title, lines, prices, diff }) {
  const out = [];
  out.push(`**Summary for ${title || url}**`);
  if (prices.length) {
    const top = prices.slice(0, 5).map(p => `${p.currency} ${p.value}`).join(", ");
    out.push(`**Pricing signals:** ${top}.`);
  }
  if (diff.added.length) {
    out.push(`**New items:** ${diff.added.slice(0, 5).join(" | ")}${diff.added.length > 5 ? "…" : ""}`);
  }
  if (diff.changed.length) {
    out.push(`**Changed content detected** (${diff.changed.length} changes).`);
  }
  if (!prices.length && !diff.added.length && !diff.changed.length) {
    out.push(`No significant changes detected.`);
  }
  return out.join("\n");
}
