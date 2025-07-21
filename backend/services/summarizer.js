import { generateWithFallback, extractJsonArray } from '../gemini/geminiClient.js';
import { nowISO } from '../utils/time.js';

export async function summarizeChanges(websiteChanges = [], rssUpdates = []) {
  const websiteSection = websiteChanges.length
    ? websiteChanges.map(w => {
        const added = (w.added || []).slice(0,3).map(b => trunc(b.text, 110)).join(' || ') || '—';
        const modified = (w.modified || []).slice(0,2).map(m => trunc(m.new?.text || '', 110)).join(' || ') || '—';
        const price = (w.priceChanges || []).map(pc => `${pc.oldPrices?.join(',')}→${pc.newPrices?.join(',')}`).join(' | ') || '—';
        return `URL: ${w.url}\nAdded: ${added}\nModified: ${modified}\nPriceChanges: ${price}`;
      }).join('\n\n')
    : 'None';

  const rssSection = rssUpdates.length
    ? rssUpdates.map(r => {
        const items = r.newItems?.slice(0,5).map(i => `- ${i.title}`).join('\n') || '—';
        return `Feed: ${r.feedUrl}\nItems:\n${items}`;
      }).join('\n\n')
    : 'None';

  const prompt = `
You are an assistant producing **structured competitor updates** strictly as JSON.

Each element:
{
 "type": "WebsiteChange" | "ReleaseNote",
 "source": "<domain or feed host>",
 "category": "New Feature" | "Pricing" | "Messaging" | "Performance" | "Bug Fix" | "Other",
 "impact_level": "Low" | "Medium" | "High",
 "title": "Short title",
 "summary": "Max 25 words"
}

Only include meaningful feature/pricing/messaging releases. Ignore generic legal/footer/nav text.

Website Changes:
${websiteSection}

RSS / Release Feeds:
${rssSection}

Return ONLY a JSON array (no explanations).
`;

  try {
    const { text } = await generateWithFallback(prompt, { temperature: 0.2, maxOutputTokens: 700 });
    const items = extractJsonArray(text);
    return items;
  } catch (e) {
    console.error('[SUMMARIZER] Error:', e.message);
    return [];
  }
}

export async function buildWeeklyMarkdown(structuredItems = []) {
  if (!structuredItems.length) return 'No meaningful changes this period.';
  const bySource = groupBy(structuredItems, i => i.source || 'unknown');

  let md = `## Weekly Competitor Update (${nowISO().slice(0,10)})\n\n### Highlights\n`;
  const highlights = structuredItems.slice(0,5).map(i =>
    `- **${i.title}** (${i.category}, ${i.impact_level}) – ${i.summary}`
  );
  md += (highlights.join('\n') || 'None') + '\n\n';

  for (const [source, items] of Object.entries(bySource)) {
    md += `### ${source}\n`;
    items.forEach(i => {
      md += `- **${i.title}** (${i.category}, ${i.impact_level}) – ${i.summary}\n`;
    });
    md += '\n';
  }

  return md.trim();
}

function trunc(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] = acc[k] || []).push(x);
    return acc;
  }, {});
}
