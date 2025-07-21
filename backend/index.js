import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

import { competitorsRouter } from "./routes/competitors.js";
import { verifyToken } from "./middleware/auth.js";
import { scrapeAndSummarize } from "./services/smartScraper.js";  // <-- Add SmartScraper

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// Serve static frontend files from ../public
const publicPath = path.join(__dirname, "../public");
app.use(express.static(publicPath));

/* ------------------- SCRAPER API ------------------- */
app.post("/api/scrape", async (req, res) => {
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
/* --------------------------------------------------- */

// Protect all competitors routes with verifyToken
app.use("/api/competitors", verifyToken, competitorsRouter);

// Default route -> landing page
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "landing.html"));
});

// Fallback to landing page for unknown routes
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "landing.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
