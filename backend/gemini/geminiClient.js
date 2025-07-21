// backend/gemini/geminiClient.js
// Works with node >=18 (global fetch). If you rely on node-fetch, ensure it's installed.
import dotenv from "dotenv";
dotenv.config();
const API_KEY = process.env.GEMINI_API_KEY;

// Separate models that exist only on certain endpoints if needed later.
const MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.5-pro'
];

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Core fallback generator.
 * @param {string} prompt
 * @param {object} opts { temperature, maxOutputTokens, safetyOff }
 * @returns {Promise<{text:string, model:string, raw:any}>}
 */
export async function generateWithFallback(prompt, opts = {}) {
  const {
    temperature = 0.2,
    maxOutputTokens,
    safetyOff = true
  } = opts;

  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY missing in environment');
  }

  let lastErr;
  for (const model of MODELS) {
    const url = `${BASE}/models/${model}:generateContent?key=${API_KEY}`;
    try {
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature }
      };
      if (maxOutputTokens) body.generationConfig.maxOutputTokens = maxOutputTokens;

      // Optionally disable safety (some hackathon keys block certain benign outputs)
      if (safetyOff) {
  body.safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
  ];
}


      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        console.warn(`⚠️ Model ${model} failed: ${data.error?.message || res.status}`);
        lastErr = new Error(data.error?.message || `HTTP ${res.status}`);
        continue;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        console.log(`✅ Model used: ${model}`);
        return { text, model, raw: data };
      } else {
        console.warn(`⚠️ Model ${model} returned empty text`);
        lastErr = new Error('Empty generation');
      }
    } catch (e) {
      console.warn(`⚠️ Network/model error on ${model}: ${e.message}`);
      lastErr = e;
    }
  }

  throw lastErr || new Error('All Gemini fallback models failed');
}

/**
 * Convenience wrapper returning only text.
 */
export async function generateText(prompt, opts) {
  const { text } = await generateWithFallback(prompt, opts);
  return text;
}

/**
 * Extract JSON array from an LLM response safely.
 */
export function extractJsonArray(generatedText) {
  const start = generatedText.indexOf('[');
  const end = generatedText.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(generatedText.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
