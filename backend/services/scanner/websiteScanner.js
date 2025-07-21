import axios from 'axios';
import { extractBlocks, diffBlocks } from '../../utils/diff.js';
import { db, FieldValue } from '../../config/firebaseAdmin.js';
import { normalizeInputUrl } from '../../utils/url.js';
import { nowISO } from '../../utils/time.js';

/**
 * Fetches and scans a given competitor website page.
 * Compares with previous version to detect changes.
 * Stores changes in Firestore.
 */
export async function scanWebsitePage(userId, competitorId, pageUrl) {
  try {
    console.log(`[SCAN] Fetching ${pageUrl} ...`);
    const res = await axios.get(pageUrl, { timeout: 15000 });
    const html = res.data;

    const newBlocks = extractBlocks(html);

    // Firestore doc for this page
    const pageRef = db
      .collection('users')
      .doc(userId)
      .collection('competitors')
      .doc(competitorId)
      .collection('pages')
      .doc(encodeURIComponent(pageUrl));

    const pageSnap = await pageRef.get();
    let oldBlocks = [];

    if (pageSnap.exists) {
      oldBlocks = pageSnap.data().blocks || [];
    }

    const diff = diffBlocks(oldBlocks, newBlocks);

    // Save current state
    await pageRef.set(
      {
        url: pageUrl,
        lastScanned: nowISO(),
        blocks: newBlocks,
        changes: FieldValue.arrayUnion({
          date: nowISO(),
          ...diff
        })
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
 * Scans all pages of a competitor website
 */
export async function scanCompetitor(userId, competitorId) {
  const compRef = db
    .collection('users')
    .doc(userId)
    .collection('competitors')
    .doc(competitorId);

  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new Error('Competitor not found');

  const competitor = compSnap.data();
  const results = [];

  for (const pageUrl of competitor.pages || []) {
    const diff = await scanWebsitePage(userId, competitorId, pageUrl);
    if (diff) results.push({ url: pageUrl, ...diff });
  }

  return results;
}
