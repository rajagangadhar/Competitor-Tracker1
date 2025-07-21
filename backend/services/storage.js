// backend/services/storage.js
import { db } from "../config/firebaseAdmin.js";
import { nowISO } from "../utils/time.js";

const PRICE_RE = /₹\s?([\d,]+(?:\.\d+)?)/g;
const MAX_FIRESTORE_SIZE = 1024 * 1024; // 1MB safe limit

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
 * Save page content into Firestore chunks (each ≤1MB).
 */
export async function savePageContent(userId, domain, pageUrl, content) {
  const contentSize = Buffer.byteLength(content, "utf8");
  const pageRef = db
    .collection("users")
    .doc(userId)
    .collection("competitors")
    .doc(domain)
    .collection("pages")
    .doc(encodeURIComponent(pageUrl));

  if (contentSize <= MAX_FIRESTORE_SIZE) {
    // Store directly
    await pageRef.set({
      url: pageUrl,
      content,
      savedAt: nowISO()
    });
    console.log(`[Storage] Saved page content for ${pageUrl} (single doc).`);
  } else {
    console.warn(
      `[Storage] Content > 1MB (${(contentSize / 1024).toFixed(
        2
      )} KB). Splitting into chunks.`
    );

    const chunks = [];
    for (let i = 0; i < content.length; i += MAX_FIRESTORE_SIZE) {
      chunks.push(content.slice(i, i + MAX_FIRESTORE_SIZE));
    }

    // Save metadata
    await pageRef.set({
      url: pageUrl,
      chunkCount: chunks.length,
      savedAt: nowISO()
    });

    // Save each chunk
    const writes = chunks.map((chunk, idx) =>
      pageRef.collection("chunks").doc(`part${idx + 1}`).set({ content: chunk })
    );
    await Promise.all(writes);

    console.log(`[Storage] Saved ${chunks.length} chunk(s) for ${pageUrl}`);
  }
}

/**
 * Retrieve page content (reassembles chunks if needed).
 */
export async function getPageContent(userId, domain, pageUrl) {
  const pageRef = db
    .collection("users")
    .doc(userId)
    .collection("competitors")
    .doc(domain)
    .collection("pages")
    .doc(encodeURIComponent(pageUrl));

  const snap = await pageRef.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data.content) {
    // Single document storage
    return data.content;
  }

  if (data.chunkCount) {
    // Assemble content from chunks
    const chunksSnap = await pageRef.collection("chunks").orderBy("id").get();
    const content = chunksSnap.docs
      .map(d => d.data().content || "")
      .join("");
    return content;
  }

  return null;
}

/**
 * Save diff results as one document per change.
 */
export async function saveWebsiteDiff(userId, domain, url, diff) {
  const col = db
    .collection("users")
    .doc(userId)
    .collection("competitor_updates");

  const timestamp = nowISO();
  const writes = [];
  const seenHashes = new Set();

  // PRICE CHANGES
  if (diff.priceChanges?.length) {
    for (const pc of diff.priceChanges) {
      const oldP = pc.oldPrices?.length
        ? parsePrice(pc.oldPrices[0])
        : firstPriceInText(pc.oldText);
      const newP = pc.newPrices?.length
        ? parsePrice(pc.newPrices[0])
        : firstPriceInText(pc.newText);
      const itemName = guessItemName(pc.newText || pc.oldText);

      const hashKey = `price:${itemName}:${oldP}:${newP}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(
        col.add({
          type: "priceChange",
          domain,
          source: url,
          itemName,
          oldPrice: oldP,
          newPrice: newP,
          oldSnippet: trunc(pc.oldText, 180),
          newSnippet: trunc(pc.newText, 180),
          timestamp
        })
      );
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

      writes.push(
        col.add({
          type: "contentUpdate",
          domain,
          source: url,
          oldSnippet: trunc(oldText, 200),
          newSnippet: trunc(newText, 200),
          timestamp
        })
      );
    }
  }

  // ADDED CONTENT
  if (diff.added?.length) {
    for (const a of diff.added) {
      const text = a.text || "";
      const hashKey = `add:${a.hash || text}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(
        col.add({
          type: "added",
          domain,
          source: url,
          text: trunc(text, 200),
          timestamp
        })
      );
    }
  }

  // REMOVED CONTENT
  if (diff.removed?.length) {
    for (const r of diff.removed) {
      const text = r.text || "";
      const hashKey = `rem:${r.hash || text}:${url}`;
      if (seenHashes.has(hashKey)) continue;
      seenHashes.add(hashKey);

      writes.push(
        col.add({
          type: "removed",
          domain,
          source: url,
          text: trunc(text, 200),
          timestamp
        })
      );
    }
  }

  await Promise.all(writes);
  console.log(`Stored ${writes.length} structured update docs for ${url}`);
}

/**
 * Save RSS items in unified format.
 */
export async function saveRssItems(userId, domain, feedUrl, newItems) {
  if (!newItems?.length) return;
  const col = db.collection("users").doc(userId).collection("competitor_updates");
  const writes = [];

  for (const item of newItems) {
    writes.push(
      col.add({
        type: "rss",
        domain,
        source: feedUrl,
        title: item.title || "Release Note",
        link: item.link || "",
        timestamp: item.pubDate || nowISO()
      })
    );
  }
  await Promise.all(writes);
  console.log(`Stored ${newItems.length} RSS updates for ${feedUrl}`);
}

/* ------------ helpers ---------------- */
function guessItemName(text) {
  if (!text) return "Unknown item";
  const pIdx = text.indexOf("₹");
  const slice = pIdx > -1 ? text.slice(0, pIdx) : text;
  return trunc(slice.trim().replace(/\s+/g, " "), 60) || "Unknown item";
}

function trunc(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
