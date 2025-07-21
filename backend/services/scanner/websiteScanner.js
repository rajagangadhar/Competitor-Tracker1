import axios from "axios";
import { extractBlocks, diffBlocks } from "../../utils/diff.js";
import { db, FieldValue } from "../../config/firebaseAdmin.js";
import { normalizeInputUrl } from "../../utils/url.js";
import { nowISO } from "../../utils/time.js";
import { savePageContent, getPageContent } from "../storage.js";

/**
 * Fetch and scan a given competitor website page.
 * Compares with previous version to detect changes.
 * Stores the new snapshot in chunks if >1MB.
 */
export async function scanWebsitePage(userId, competitorId, pageUrl) {
  try {
    console.log(`[SCAN] Fetching ${pageUrl} ...`);
    const res = await axios.get(pageUrl, { timeout: 15000 });
    const html = res.data;

    // Extract text blocks from HTML
    const newBlocks = extractBlocks(html);

    // Load old blocks from Firestore (via page content)
    const oldBlocks = [];
    const oldContent = await getPageContent(userId, competitorId, pageUrl);
    if (oldContent) {
      try {
        const parsed = JSON.parse(oldContent);
        if (Array.isArray(parsed.blocks)) oldBlocks.push(...parsed.blocks);
      } catch {
        console.warn("[SCAN] Previous page content was not JSON blocks.");
      }
    }

    // Calculate diff
    const diff = diffBlocks(oldBlocks, newBlocks);

    // Save HTML snapshot (chunked if needed)
    const pageSnapshot = JSON.stringify({ blocks: newBlocks });
    await savePageContent(userId, competitorId, pageUrl, pageSnapshot);

    // Store metadata about changes
    const pageRef = db
      .collection("users")
      .doc(userId)
      .collection("competitors")
      .doc(competitorId)
      .collection("pages")
      .doc(encodeURIComponent(pageUrl));

    await pageRef.set(
      {
        url: pageUrl,
        lastScanned: nowISO(),
        // Store only lightweight change metadata here
        lastDiff: diff,
        changes: FieldValue.arrayUnion({
          date: nowISO(),
          ...diff,
        }),
      },
      { merge: true }
    );

    console.log(`[SCAN] Completed ${pageUrl}. Changes:`, diff);
    return diff;
  } catch (err) {
    console.error(`[SCAN] Error scanning ${pageUrl}:`, err.message);
    return null;
  }
}

/**
 * Scans all pages of a competitor website.
 */
export async function scanCompetitor(userId, competitorId) {
  const compRef = db
    .collection("users")
    .doc(userId)
    .collection("competitors")
    .doc(competitorId);

  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new Error("Competitor not found");

  const competitor = compSnap.data();
  const results = [];

  for (const pageUrl of competitor.pages || []) {
    const diff = await scanWebsitePage(userId, competitorId, pageUrl);
    if (diff) results.push({ url: pageUrl, ...diff });
  }

  return results;
}
