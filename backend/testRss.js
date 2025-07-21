import { scanRssFeed } from './services/scanner/rssScanner.js';

const userId = 'testUser';
const competitorId = 'amazon';
const feedUrl = 'https://www.aboutamazon.in/feed'; // Example RSS feed

scanRssFeed(userId, competitorId, feedUrl)
  .then(newItems => console.log('New RSS Items:', newItems))
  .catch(console.error);
