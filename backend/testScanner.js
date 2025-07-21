import { scanWebsitePage } from './services/scanner/websiteScanner.js';

const userId = 'testUser';
const competitorId = 'amazon';

const pageUrl = 'https://www.amazon.in/';
scanWebsitePage(userId, competitorId, pageUrl)
  .then(diff => console.log('Scan result:', diff))
  .catch(console.error);
