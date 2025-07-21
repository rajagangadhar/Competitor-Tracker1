import express from 'express';
import { scanUserCompetitors } from '../services/scanner/orchestrator.js';

export const scanRouter = express.Router();

/**
 * POST /api/scan/run
 * Runs a scan only for the authenticated user.
 */
scanRouter.post('/run', async (req, res) => {
  try {
    const userId = req.userId;
    const result = await scanUserCompetitors(userId);
    res.json({ ok: true, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
