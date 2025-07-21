import { hash } from './hash.js';
import * as cheerio from 'cheerio';


/**
 * Extract meaningful text blocks from HTML.
 * We ignore very short fragments to reduce noise.
 */
export function extractBlocks(html) {
  const $ = cheerio.load(html);
  // Remove non-content
  $('script, style, noscript').remove();

  const blocks = [];
  $('body *').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;
    if (['p','li','h1','h2','h3','h4','h5','h6','td','th','span','div'].includes(tag)) {
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text && text.length > 25) {           // only keep useful size
        blocks.push(text);
      }
    }
  });

  return blocks.map((text, idx) => ({
    idx,
    text,
    hash: hash(text)
  }));
}

/**
 * Compare previous and new blocks.
 * Returns added / removed / modified blocks + detected price changes.
 */
export function diffBlocks(oldBlocks = [], newBlocks = []) {
  const oldMap = new Map(oldBlocks.map(b => [b.hash, b]));
  const newMap = new Map(newBlocks.map(b => [b.hash, b]));

  const addedRaw = [];
  const removedRaw = [];

  for (const nb of newBlocks) {
    if (!oldMap.has(nb.hash)) addedRaw.push(nb);
  }
  for (const ob of oldBlocks) {
    if (!newMap.has(ob.hash)) removedRaw.push(ob);
  }

  // Try to pair added + removed into "modified" when texts are similar
  const modified = [];
  const stillAdded = [];
  const stillRemoved = [...removedRaw];

  for (const a of addedRaw) {
    let best = null;
    let bestScore = 0;
    for (const r of stillRemoved) {
      const score = similarity(a.text, r.text);
      if (score > 0.55 && score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (best) {
      modified.push({ old: best, new: a, similarity: bestScore });
      // remove matched removed block
      const idx = stillRemoved.indexOf(best);
      if (idx !== -1) stillRemoved.splice(idx, 1);
    } else {
      stillAdded.push(a);
    }
  }

  const priceChanges = detectPriceChanges(modified);

  return {
    added: stillAdded,
    removed: stillRemoved,
    modified,
    priceChanges
  };
}

/**
 * Very simple similarity: intersection of word sets / max size
 */
function similarity(aText, bText) {
  const setA = new Set(aText.split(/\s+/));
  const setB = new Set(bText.split(/\s+/));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return intersection / Math.max(setA.size, setB.size);
}

/**
 * Look for price tokens that changed within modified blocks.
 */
function detectPriceChanges(modified) {
  const priceRegex = /(?:₹|\$|€)\s?\d+(?:[.,]\d+)?/g;
  const changes = [];
  for (const m of modified) {
    const oldPrices = m.old.text.match(priceRegex) || [];
    const newPrices = m.new.text.match(priceRegex) || [];
    if (
      (oldPrices.length || newPrices.length) &&
      JSON.stringify(oldPrices) !== JSON.stringify(newPrices)
    ) {
      changes.push({
        oldText: m.old.text.slice(0, 300),
        newText: m.new.text.slice(0, 300),
        oldPrices,
        newPrices
      });
    }
  }
  return changes;
}
