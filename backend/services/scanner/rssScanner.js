import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { db, FieldValue } from '../../config/firebaseAdmin.js';
import { nowISO } from '../../utils/time.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true
});

/**
 * Fetch RSS XML and parse safely.
 */
async function fetchAndParseRSS(feedUrl) {
  const response = await axios.get(feedUrl, { timeout: 15000 });
  let xml = response.data;

  // Fix unescaped ampersands (&) that are not proper entities
  xml = xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+);)/g, '&amp;');

  const parsed = parser.parse(xml);

  // Most RSS feeds have structure: { rss: { channel: { item: [...] } } }
  if (parsed.rss?.channel?.item) {
    return Array.isArray(parsed.rss.channel.item)
      ? parsed.rss.channel.item
      : [parsed.rss.channel.item];
  }
  // Atom feeds use feed.entry
  if (parsed.feed?.entry) {
    return Array.isArray(parsed.feed.entry)
      ? parsed.feed.entry
      : [parsed.feed.entry];
  }

  return [];
}

/**
 * Scans a single RSS feed URL.
 * Compares new items with previously stored items.
 */
export async function scanRssFeed(userId, competitorId, feedUrl) {
  try {
    console.log(`[RSS] Checking feed: ${feedUrl}`);
    const items = await fetchAndParseRSS(feedUrl);

    const feedRef = db
      .collection('users')
      .doc(userId)
      .collection('competitors')
      .doc(competitorId)
      .collection('rssFeeds')
      .doc(encodeURIComponent(feedUrl));

    const feedSnap = await feedRef.get();
    const oldItems = feedSnap.exists ? feedSnap.data().items || [] : [];

    const newItems = [];
    for (const item of items) {
      const link = item.link?.href || item.link || '';
      if (!oldItems.find(i => i.link === link)) {
        newItems.push({
          title: item.title || '',
          link: link,
          pubDate: item.pubDate || item.updated || nowISO()
        });
      }
    }

    if (newItems.length > 0) {
      await feedRef.set(
        {
          url: feedUrl,
          lastChecked: nowISO(),
          items: [...oldItems, ...newItems]
        },
        { merge: true }
      );
      console.log(`[RSS] New items found:`, newItems.length);
    } else {
      console.log(`[RSS] No new items for: ${feedUrl}`);
    }

    return newItems;
  } catch (err) {
    console.error(`[RSS] Error scanning ${feedUrl}:`, err.message);
    return null;
  }
}

export async function scanAllRssFeeds(userId, competitorId) {
  const compRef = db
    .collection('users')
    .doc(userId)
    .collection('competitors')
    .doc(competitorId);

  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new Error('Competitor not found');

  const competitor = compSnap.data();
  const rssFeeds = competitor.rssFeeds || [];
  const results = [];

  for (const feedUrl of rssFeeds) {
    const newItems = await scanRssFeed(userId, competitorId, feedUrl);
    if (newItems && newItems.length > 0) {
      results.push({ feedUrl, newItems });
    }
  }

  return results;
}
