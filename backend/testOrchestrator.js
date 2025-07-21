import 'dotenv/config';
import { scanUserCompetitors } from './services/scanner/orchestrator.js';

const userId = 'testUser';

(async () => {
  const result = await scanUserCompetitors(userId);
  console.log('Scan summary:', JSON.stringify(result, null, 2));
})();

