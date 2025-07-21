import express from "express";
import { scrapeAndSummarize } from "../services/smartScraper.js";

export const scraperRouter = express.Router();

// POST /api/scraper
scraperRouter.post("/", async (req, res) => {
  const { url, previousText } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const result = await scrapeAndSummarize({ url, previousText });
    res.json(result);
  } catch (error) {
    console.error("[Scraper API Error]:", error);
    res.status(500).json({ error: "Scraping failed", details: error.message });
  }
});
