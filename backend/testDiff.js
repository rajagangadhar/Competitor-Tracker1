import fs from 'fs';
import { extractBlocks, diffBlocks } from './utils/diff.js';

const oldHtml = `<html><body>
  <h1>Pricing Plans</h1>
  <p>Basic plan only $10 per month.</p>
</body></html>`;

const newHtml = `<html><body>
  <h1>Pricing Plans</h1>
  <p>Basic plan now $12 per month with new features.</p>
</body></html>`;

const oldBlocks = extractBlocks(oldHtml);
const newBlocks = extractBlocks(newHtml);
const diff = diffBlocks(oldBlocks, newBlocks);
console.log(JSON.stringify(diff, null, 2));

