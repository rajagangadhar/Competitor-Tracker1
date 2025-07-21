// backend/routes/competitors.js
import express from "express";
import { db, FieldValue } from "../config/firebaseAdmin.js";
import { normalizeInputUrl } from "../utils/url.js";
import { scanWebsitePage } from "../services/scanner/websiteScanner.js";
import { scanRssFeed } from "../services/scanner/rssScanner.js";
import { saveWebsiteDiff, saveRssItems } from "../services/storage.js";
import { generateText } from "../gemini/geminiClient.js";

// ------------------------------------------------------------------
// Auth: use req.user?.uid if middleware set; fallback for local dev.
// ------------------------------------------------------------------
function getUid(req) {
  return req.user?.uid || "testUser";
}

export const competitorsRouter = express.Router();

/* ---------------------- small helpers ---------------------- */
function compRef(uid, domain) {
  return db.collection("users").doc(uid).collection("competitors").doc(domain);
}

function coerceRssFeeds(input, domain) {
  if (!input) return [];
  const arr = Array.isArray(input)
    ? input
    : String(input).split(",").map(s => s.trim());
  return arr
    .filter(Boolean)
    .map(u => absolutizeUrl(u, domain))
    .filter(Boolean);
}

function absolutizeUrl(u, domain) {
  // has scheme?
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith("/")) u = "/" + u;
  return `https://${domain}${u}`;
}

/* ------------------------------------------------------------------
 * POST /api/competitors
 * Body: { url, name, rssFeeds? }
 * ------------------------------------------------------------------ */
competitorsRouter.post("/", async (req, res) => {
  const uid = getUid(req);
  try {
    const { url, name, rssFeeds } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    const { domain, path } = normalizeInputUrl(url);
    const feeds = coerceRssFeeds(rssFeeds, domain);
    const ref = compRef(uid, domain);

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const nowServer = FieldValue.serverTimestamp();
      const nowClient = Date.now();

      if (!snap.exists) {
        tx.set(ref, {
          domain,
          displayName: name || domain,
          createdAt: nowServer,
          pages: [{ path, addedAt: nowClient }],
          rssFeeds: feeds,
          lastScanAt: null
        });
        return { created: true, domain, path };
      }

      const data = snap.data() || {};
      const pages = data.pages || [];
      if (pages.some(p => p.path === path)) {
        return { created: false, conflict: true, domain, path };
      }
      pages.push({ path, addedAt: nowClient });

      const update = { pages };
      if (feeds.length) {
        const merged = Array.from(new Set([...(data.rssFeeds || []), ...feeds]));
        update.rssFeeds = merged;
      }
      tx.update(ref, update);
      return { created: false, domain, path };
    });

    if (result.conflict) {
      return res.status(409).json({
        error: "Already added",
        domain: result.domain,
        path: result.path
      });
    }

    res.status(result.created ? 201 : 200).json({
      message: result.created ? "Competitor added" : "Path added to competitor",
      domain: result.domain,
      path: result.path
    });
  } catch (e) {
    console.error("[POST /competitors] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * GET /api/competitors
 * List competitors for current user.
 * ------------------------------------------------------------------ */
competitorsRouter.get("/", async (req, res) => {
  const uid = getUid(req);
  try {
    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("competitors")
      .orderBy("createdAt", "desc")
      .get();

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ competitors: items });
  } catch (e) {
    console.error("[GET /competitors] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * GET /api/competitors/:domain
 * Structured report + raw updates.
 * ------------------------------------------------------------------ */
competitorsRouter.get("/:domain", async (req, res) => {
  const uid = getUid(req);
  try {
    const { domain } = req.params;
    const ref = compRef(uid, domain);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const raw = await getUpdatesForDomain(uid, domain, 100);
    const report = buildReport(raw);

    res.json({
      competitor: { id: snap.id, ...snap.data() },
      report,
      raw
    });
  } catch (e) {
    console.error("[GET /competitors/:domain] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * GET /api/competitors/:domain/ai-summary
 * Summarize last ~30 updates via Gemini.
 * ------------------------------------------------------------------ */
competitorsRouter.get("/:domain/ai-summary", async (req, res) => {
  const uid = getUid(req);
  try {
    const { domain } = req.params;
    const raw = await getUpdatesForDomain(uid, domain, 30);
    const report = buildReport(raw);
    const prompt = buildAISummaryPrompt(domain, report);
    const aiSummary = await generateText(prompt, {
      temperature: 0.3,
      maxOutputTokens: 500
    });
    res.json({ domain, aiSummary, report });
  } catch (e) {
    console.error("[AI Summary error]", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * PUT /api/competitors/:domain
 * Update name and/or rssFeeds.
 * ------------------------------------------------------------------ */
competitorsRouter.put("/:domain", async (req, res) => {
  const uid = getUid(req);
  try {
    const { domain } = req.params;
    const { name, rssFeeds } = req.body;
    const update = {};
    if (name) update.displayName = name;
    if (rssFeeds !== undefined) update.rssFeeds = coerceRssFeeds(rssFeeds, domain);
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    await compRef(uid, domain).update(update);
    res.json({ message: "Updated", domain });
  } catch (e) {
    console.error("[PUT /competitors/:domain] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * DELETE /api/competitors/:domain
 * Remove competitor doc (subcollections left in place for now).
 * ------------------------------------------------------------------ */
competitorsRouter.delete("/:domain", async (req, res) => {
  const uid = getUid(req);
  try {
    const { domain } = req.params;
    await compRef(uid, domain).delete();
    res.json({ message: "Deleted", domain });
  } catch (e) {
    console.error("[DELETE /competitors/:domain] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------
 * POST /api/competitors/:domain/scan
 * Scan all pages + RSS feeds; filter junk; persist updates.
 * ------------------------------------------------------------------ */
competitorsRouter.post("/:domain/scan", async (req, res) => {
  const uid = getUid(req);
  try {
    const { domain } = req.params;
    const ref = compRef(uid, domain);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Not found" });

    const data = snap.data();
    const pages = data.pages || [];
    const rssFeeds = data.rssFeeds || [];
    let websiteUpdates = 0;
    let rssUpdates = 0;

    // WEBSITE SCAN
    for (const p of pages) {
      const pagePath = typeof p === "string" ? p : p.path;
      const url =
        pagePath.startsWith("http") ? pagePath : `https://${domain}${pagePath === "/" ? "" : pagePath}`;

      const rawDiff = await scanWebsitePage(uid, domain, url);
      const diff = filterWebsiteDiff(rawDiff); // 👈 NEW CLEANUP

      if (diffHasChanges(diff)) {
        await saveWebsiteDiff(uid, domain, url, diff);
        websiteUpdates +=
          (diff.added?.length || 0) +
          (diff.modified?.length || 0) +
          (diff.removed?.length || 0) +
          (diff.priceChanges?.length || 0);
      }
    }

    // RSS SCAN
    for (const feedUrl of rssFeeds) {
      const newItems = await scanRssFeed(uid, domain, feedUrl);
      if (newItems?.length) {
        await saveRssItems(uid, domain, feedUrl, newItems);
        rssUpdates += newItems.length;
      }
    }

    await ref.update({ lastScanAt: FieldValue.serverTimestamp() });

    res.json({
      message: "Scan complete",
      domain,
      websiteUpdates,
      rssUpdates
    });
  } catch (e) {
    console.error("[POST /competitors/:domain/scan] error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ===================== REPORT HELPERS ===================== */
function trunc(str, n) {
  if (!str) return "";
  const s = str.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toTs(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toDate === "function") return v.toDate().getTime(); // Firestore Timestamp
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

async function getUpdatesForDomain(uid, domain, limit = 50) {
  // No orderBy → no composite index needed
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("competitor_updates")
    .where("domain", "==", domain)
    .get();

  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  arr.sort((a, b) => toTs(b.timestamp) - toTs(a.timestamp));
  return arr.slice(0, limit);
}

function buildReport(raw) {
  const seenAdd = new Set();
  const seenRem = new Set();
  const seenContent = new Set();
  const seenPrice = new Set();
  const report = { priceChanges: [], contentUpdates: [], additions: [], removals: [] };

  for (const upd of raw) {
    const ts = toTs(upd.timestamp);
    const time = new Date(ts).toISOString();
    const url = upd.source || upd.url || "";

    switch (upd.type) {
      case "priceChange": {
        const k = `${upd.itemName || ""}|${upd.oldPrice}|${upd.newPrice}|${url}`;
        if (seenPrice.has(k)) break;
        seenPrice.add(k);
        const direction =
          typeof upd.oldPrice === "number" && typeof upd.newPrice === "number"
            ? upd.oldPrice > upd.newPrice
              ? "drop"
              : upd.oldPrice < upd.newPrice
              ? "increase"
              : "same"
            : "change";
        report.priceChanges.push({
          itemName: trunc(upd.itemName || "Unknown item", 80),
          oldPrice: upd.oldPrice ?? null,
          newPrice: upd.newPrice ?? null,
          direction,
          time,
          url
        });
        break;
      }

      case "contentUpdate":
      case "modified": {
        const oldSnip = trunc(upd.oldContent || upd.oldSnippet || upd.summary || "", 140);
        const newSnip = trunc(upd.newContent || upd.newSnippet || "", 140);
        const k = `${oldSnip}|${newSnip}|${url}`;
        if (seenContent.has(k)) break;
        seenContent.add(k);
        if (isJunkText(oldSnip) && isJunkText(newSnip)) break;
        report.contentUpdates.push({ oldSnippet: oldSnip, newSnippet: newSnip, time, url });
        break;
      }

      case "added": {
        const text = trunc(upd.content || upd.summary || upd.text || "", 140);
        if (!text || isJunkText(text) || seenAdd.has(text)) break;
        seenAdd.add(text);
        report.additions.push({ text, time, url });
        break;
      }

      case "removed": {
        const text = trunc(upd.content || upd.summary || upd.text || "", 140);
        if (!text || isJunkText(text) || seenRem.has(text)) break;
        seenRem.add(text);
        report.removals.push({ text, time, url });
        break;
      }

      default:
        break;
    }
  }
  return report;
}

function buildAISummaryPrompt(domain, report) {
  // cap counts to keep prompt short
  const MAX = 10;
  const pcs = report.priceChanges.slice(0, MAX);
  const cus = report.contentUpdates.slice(0, MAX);
  const adds = report.additions.slice(0, MAX);
  const rms = report.removals.slice(0, MAX);

  return `
You are an assistant summarizing product/marketing changes observed on competitor site: ${domain}.
Please produce a concise PM-friendly summary (<200 words) that highlights:
- Meaningful pricing moves (increases/drops)
- Major UI/feature/content shifts
- Newly added sections or offers (group similar ones)
- Any removed/retired messaging that matters

Use bullet points. Avoid noise (cookie banners, footer links, boilerplate). If little signal, say so.

DATA BELOW
---
PRICE CHANGES:
${pcs.map(pc => `- ${pc.itemName}: ${pc.oldPrice} → ${pc.newPrice} (${pc.direction})`).join("\n")}

CONTENT UPDATES:
${cus.map(c => `- BEFORE: ${c.oldSnippet} | AFTER: ${c.newSnippet}`).join("\n")}

ADDED:
${adds.map(a => `- ${a.text}`).join("\n")}

REMOVED:
${rms.map(r => `- ${r.text}`).join("\n")}
---
`.trim();
}

/* ===================== DIFF FILTERING ===================== */
/** Return true if diff object has any non-empty array. */
function diffHasChanges(diff) {
  return (
    (diff?.added?.length || 0) +
      (diff?.modified?.length || 0) +
      (diff?.removed?.length || 0) +
      (diff?.priceChanges?.length || 0) >
    0
  );
}

/** Heuristic junk detection for text blocks. */
function isJunkText(text) {
  if (!text) return true;
  const t = text.toLowerCase();

  // drop very short segments unless contain currency or % (likely price/promo)
  if (t.length < 8 && !/[₹$€£0-9%]/.test(t)) return true;

  // common boilerplate patterns
  const junkPatterns = [
    "conditions of use",
    "privacy notice",
    "interest-based ads",
    "keyboard shortcuts",
    "skip to main content",
    "continue shopping",
    "copyright",
    "© 1996",
    "© 202",
    "sign in",
    "cart shift +",
    "update location",
    "cookies",
    "cookie",
    "data preferences",
    "your account",
    "returns & orders",
    "back to top"
  ];
  if (junkPatterns.some(p => t.includes(p))) return true;

  // if >60% punctuation / digits and no spaces => probably sku code
  const noSpace = t.replace(/\s+/g, "");
  const punctPct = (noSpace.replace(/[a-z0-9]/gi, "").length / noSpace.length) || 0;
  if (punctPct > 0.6 && !/[a-z]/.test(t)) return true;

  return false;
}

/** Remove dupes & junk from scanner diff before storage. */
function filterWebsiteDiff(diff) {
  if (!diff) return diff;

  const dedup = arr => {
    if (!Array.isArray(arr)) return [];
    const out = [];
    const seen = new Set();
    for (const b of arr) {
      const txt = (b?.text || "").replace(/\s+/g, " ").trim();
      if (!txt) continue;
      if (isJunkText(txt)) continue;
      const h = b.hash || hashText(txt);
      if (seen.has(h)) continue;
      seen.add(h);
      out.push({ ...b, text: txt, hash: h });
    }
    return out;
  };

  const filtered = {
    added: dedup(diff.added),
    removed: dedup(diff.removed),
    priceChanges: Array.isArray(diff.priceChanges)
      ? diff.priceChanges.filter(pc => {
          if (!pc) return false;
          // drop junk itemName
          const nm = pc.itemName || pc.oldText || pc.newText || "";
          if (isJunkText(nm)) return false;
          // drop if same price
          if (pc.oldPrice != null && pc.newPrice != null && pc.oldPrice === pc.newPrice) return false;
          return true;
        })
      : [],
    modified: Array.isArray(diff.modified)
      ? diff.modified
          .map(m => {
            const oldT = (m.old?.text || "").replace(/\s+/g, " ").trim();
            const newT = (m.new?.text || "").replace(/\s+/g, " ").trim();
            if (!oldT && !newT) return null;
            if (isJunkText(oldT) && isJunkText(newT)) return null;
            return {
              ...m,
              old: { ...(m.old || {}), text: oldT },
              new: { ...(m.new || {}), text: newT }
            };
          })
          .filter(Boolean)
      : []
  };

  return filtered;
}

/** Cheap hash if none provided. */
function hashText(str) {
  let h = 0,
    i,
    chr;
  if (str.length === 0) return "0";
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    h = (h << 5) - h + chr;
    h |= 0;
  }
  return String(h >>> 0);
}

//export default competitorsRouter;
