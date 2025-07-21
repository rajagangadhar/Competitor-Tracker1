import 'dotenv/config';
import { summarizeChanges, buildWeeklyMarkdown } from './services/summarizer.js';


const websiteChanges = [
  {
    url: 'https://example.com/pricing',
    added: [{ text: 'Pro Plan now includes AI Assistant for $29/month with early access.' }],
    modified: [],
    removed: [],
    priceChanges: [{ oldPrices: ['$19'], newPrices: ['$29'] }]
  }
];

const rssUpdates = [
  {
    feedUrl: 'https://example.com/changelog',
    newItems: [
      { title: 'Launched Team Dashboard', link: 'https://example.com/changelog/team-dashboard' },
      { title: 'Added Bulk Import', link: 'https://example.com/changelog/bulk-import' }
    ]
  }
];

(async () => {
  const structured = await summarizeChanges(websiteChanges, rssUpdates);
  console.log('Structured Items:', structured);
  const md = await buildWeeklyMarkdown(structured);
  console.log('\nMarkdown:\n', md);
})();
