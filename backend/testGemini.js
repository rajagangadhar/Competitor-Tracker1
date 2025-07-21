// backend/testGemini.js
import { generateWithFallback } from './gemini/geminiClient.js';

const prompt = "Summarize this in one sentence: 'Google Gemini is an AI model.'";
generateWithFallback(prompt)
  .then(res => console.log("Gemini Output:", res))
  .catch(err => console.error("Error:", err.message));
