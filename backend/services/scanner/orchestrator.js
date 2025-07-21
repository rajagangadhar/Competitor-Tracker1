import { db, FieldValue } from '../../config/firebaseAdmin.js';
import { scanWebsitePage, scanCompetitor } from './websiteScanner.js';
import { scanRssFeed } from './rssScanner.js';
import { saveWebsiteDiff, saveRssItems } from '../storage.js';

/**
 * Scan all competitors for ONE user.
 * Returns an array of { domain, websiteUpdatesCount, rssUpdatesCount }
 */
export async function scanUserCompetitors(userId) {
  const compsSnap = await db.collection('users').doc(userId).collection('competitors').get();
  const results = [];

  for (const compDoc of compsSnap.docs) {
    const data = compDoc.data();
    const domain = data.domain || compDoc.id;

    let websiteUpdatesCount = 0;
    let rssUpdatesCount = 0;

    // Website pages
    for (const p of (data.pages || [])) {
      const path = typeof p === 'string' ? p : p.path;
      const url = path.startsWith('http') ? path : `https://${domain}${path === '/' ? '' : path}`;
      const diff = await scanWebsitePage(userId, domain, url);
      if (diff && (diff.added.length || diff.modified.length || diff.priceChanges.length)) {
        await saveWebsiteDiff(userId, domain, url, diff);
        websiteUpdatesCount += diff.added.length + diff.modified.length + diff.priceChanges.length;
      }
    }

    // RSS feeds
    for (const feedUrl of (data.rssFeeds || data.feeds || [])) {
      const newItems = await scanRssFeed(userId, domain, feedUrl);
      if (newItems && newItems.length) {
        await saveRssItems(userId, domain, feedUrl, newItems);
        rssUpdatesCount += newItems.length;
      }
    }

    // Update lastScanAt
    await compDoc.ref.update({ lastScanAt: FieldValue.serverTimestamp() });

    results.push({ domain, websiteUpdatesCount, rssUpdatesCount });
  }

  return results;
}

/**
 * Scan ALL users (used for cron).
 */
export async function scanAllUsers() {
  const usersSnap = await db.collection('users').get();
  const summary = [];
  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;
    const r = await scanUserCompetitors(userId);
    summary.push({ userId, competitors: r });
  }
  return summary;
}
