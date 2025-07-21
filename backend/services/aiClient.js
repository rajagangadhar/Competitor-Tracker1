// backend/services/aiClient.js
import { generateText } from "../gemini/geminiClient.js";

export async function summarizeChangesWithAI(data) {
  if (!data || !data.report) {
    throw new Error("Invalid data for AI summary");
  }

  // Ensure arrays
  const priceChanges = Array.isArray(data.report.priceChanges) ? data.report.priceChanges : [];
  const contentUpdates = Array.isArray(data.report.contentUpdates) ? data.report.contentUpdates : [];
  const additions = Array.isArray(data.report.additions) ? data.report.additions : [];
  const removals = Array.isArray(data.report.removals) ? data.report.removals : [];

  if (
    priceChanges.length === 0 &&
    contentUpdates.length === 0 &&
    additions.length === 0 &&
    removals.length === 0
  ) {
    return "No significant changes detected.";
  }

  const context = `
Competitor: ${data.domain}

Price Changes:
${priceChanges.map(pc => `- ${pc.itemName} (${pc.oldPrice} → ${pc.newPrice})`).join("\n")}

Content Updates:
${contentUpdates.map(cu => `- ${cu.oldSnippet} → ${cu.newSnippet}`).join("\n")}

Additions:
${additions.map(a => `- ${a.text}`).join("\n")}

Removals:
${removals.map(r => `- ${r.text}`).join("\n")}
  `.trim();

  const prompt = `
Summarize the following competitor website changes in 4-5 sentences, focusing on major updates, price trends, and new content:

${context}
  `;

  try {
    const summary = await generateText(prompt, { temperature: 0.2 });
    return summary || "AI summary unavailable.";
  } catch (err) {
    console.error("[AI Summary generation error]", err);
    return "AI summary unavailable.";
  }
}
