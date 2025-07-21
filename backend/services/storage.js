// backend/services/storage.js
import { db } from "../config/firebaseAdmin.js";
import { nowISO } from "../utils/time.js";

// Regex to detect prices like ₹1,299 or 1299 or $ etc. (basic)
const PRICE_RE = /₹\s?([\d,]+(?:\.\d+)?)/g;

/** Convert price string like "₹1,499" to number 1499 */
function parsePrice(str) {
  if (!str) return null;
  const m = /([\d,]+(?:\.\d+)?)/.exec(str.replace(/[^\d,\.]/g, ""));
  if (!m) return null;
  return Number(m[1].replace(/,/g, ""));
}

/** Extract first price in a text block */
function firstPriceInText(text) {
  if (!text) return null;
  const m = PRICE_RE.exec(text);
  PRICE_RE.lastIndex = 0; // reset regex state
  return m ? parsePrice(m[0]) : null;
}

/**
 * Save diff results as *one document per change* in the unified collection:
 * users/{userId}/competitor_updates/*
 *
 * Expected diff shape:
 * {
 *   added: [{ text, hash }],
 *   removed: [{ text, hash }],
 *   modified: [{ old:{text,hash}, new:{text,hash} }],
 *   priceChanges: [{ oldText, newText, oldPrices[], newPrices[] }]
 * }
 */
export async function saveWebsiteDiff(userId, domain, url, diff) {
  const col = db.collection("users").doc(userId).collection("competitor_updates");

  const timestamp = nowISO();
  const writes = [];

  // Dedup across this diff call
  const seenHashes = new Set();

  // PRICE CHANGES
  if (diff.priceChanges?.length) {
    for (const pc of diff.priceChanges) {
      // try to pick first changed price
      const oldP = pc.oldPrices?.length ? parsePrice(pc.oldPrices[0]) : firstPriceInText(pc.oldText);
      const newP = pc.newPrices?.length ? parsePrice(pc.newPrices[0]) : firstPriceInText(pc.newText);
      const itemName = guessItemName(pc.newText || pc.oldText);

      const hashKey = `price:${itemName}:${oldP}:${newP}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(col.add({
        type: "priceChange",
        domain,
        source: url,
        itemName,
        oldPrice: oldP,
        newPrice: newP,
        oldSnippet: trunc(pc.oldText, 180),
        newSnippet: trunc(pc.newText, 180),
        timestamp
      }));
    }
  }

  // MODIFIED CONTENT
  if (diff.modified?.length) {
    for (const m of diff.modified) {
      const oldText = m.old?.text || "";
      const newText = m.new?.text || "";
      const hashKey = `mod:${m.old?.hash || oldText}:${m.new?.hash || newText}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(col.add({
        type: "contentUpdate",
        domain,
        source: url,
        oldSnippet: trunc(oldText, 200),
        newSnippet: trunc(newText, 200),
        timestamp
      }));
    }
  }

  // ADDED CONTENT
  if (diff.added?.length) {
    for (const a of diff.added) {
      const text = a.text || "";
      const hashKey = `add:${a.hash || text}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(col.add({
        type: "added",
        domain,
        source: url,
        text: trunc(text, 200),
        timestamp
      }));
    }
  }

  // REMOVED CONTENT
  if (diff.removed?.length) {
    for (const r of diff.removed) {
      const text = r.text || "";
      const hashKey = `rem:${r.hash || text}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(col.add({
        type: "removed",
        domain,
        source: url,
        text: trunc(text, 200),
        timestamp
      }));
    }
  }

  await Promise.all(writes);
  console.log(`Stored ${writes.length} structured update docs for ${url}`);
}

/**
 * Save RSS items in unified format.
 * newItems: [{title, link, pubDate}]
 */
export async function saveRssItems(userId, domain, feedUrl, newItems) {
  if (!newItems?.length) return;
  const col = db.collection("users").doc(userId).collection("competitor_updates");
  const writes = [];

  for (const item of newItems) {
    writes.push(col.add({
      type: "rss",
      domain,
      source: feedUrl,
      title: item.title || "Release Note",
      link: item.link || "",
      timestamp: item.pubDate || nowISO()
    }));
  }
  await Promise.all(writes);
  console.log(`Stored ${newItems.length} RSS updates for ${feedUrl}`);
}

/* ------------ helpers ---------------- */
function guessItemName(text) {
  if (!text) return "Unknown item";
  // crude heuristic: first ~8 words before the first price symbol
  const pIdx = text.indexOf("₹");
  const slice = pIdx > -1 ? text.slice(0, pIdx) : text;
  return trunc(slice.trim().replace(/\s+/g, " "), 60) || "Unknown item";
}

function trunc(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
