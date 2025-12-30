/**
 * Gemini Agent - Bulk Text Processing Tool
 *
 * Used by research agent for "slave labor" tasks:
 * - Summarizing large documents (transcripts, articles, filings)
 * - Extracting specific facts from bulk text
 * - Processing data too large to fit in Claude context efficiently
 *
 * The research agent sees metadata (word count, source type) and decides
 * when to offload to Gemini vs process directly.
 *
 * Model: gemini-2.0-flash-exp (fast, cheap, 1M context)
 */

import 'dotenv/config';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash-exp';

interface GeminiRequest {
  text: string;
  instruction: string;
  model?: string;
}

interface GeminiResponse {
  result: string;
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
  model: string;
}

/**
 * Process text with Gemini
 *
 * @param text - The bulk text to process (can be very large)
 * @param instruction - What to do with it (summarize, extract, analyze)
 * @returns Processed result
 */
export async function gemini(request: GeminiRequest): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in environment');
  }

  const model = request.model || DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `${request.instruction}

---
TEXT TO PROCESS:
${request.text}
---

Respond with only the requested output, no preamble.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      }
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Unexpected Gemini response format');
  }

  return {
    result: data.candidates[0].content.parts[0].text,
    tokenCount: {
      input: data.usageMetadata?.promptTokenCount || 0,
      output: data.usageMetadata?.candidatesTokenCount || 0,
      total: data.usageMetadata?.totalTokenCount || 0,
    },
    model,
  };
}

/**
 * Convenience functions for common operations
 */

export async function summarize(text: string, focus?: string): Promise<string> {
  const instruction = focus
    ? `Summarize the following text, focusing specifically on: ${focus}`
    : 'Summarize the following text concisely, preserving key facts and figures.';

  const response = await gemini({ text, instruction });
  return response.result;
}

export async function extractFacts(text: string, factsToFind: string): Promise<string> {
  const instruction = `Extract the following information from the text: ${factsToFind}

Format as a bullet list. If information is not found, say "Not found".`;

  const response = await gemini({ text, instruction });
  return response.result;
}

export async function analyzeForPrediction(text: string, marketQuestion: string): Promise<string> {
  const instruction = `You are analyzing source material for a prediction market question: "${marketQuestion}"

Extract and organize:
1. FACTS: Concrete, verifiable information relevant to this question
2. SIGNALS: Indicators or trends that suggest direction
3. UNCERTAINTIES: What's unclear or contested in this source
4. KEY QUOTES: Direct quotes that are particularly revealing (max 3)

Be factual and specific. No speculation - just what the source says.`;

  const response = await gemini({ text, instruction });
  return response.result;
}

/**
 * Get metadata about text without processing it
 * Useful for research agent to decide whether to use Gemini
 */
export function getTextMetadata(text: string): { words: number; chars: number; lines: number; estimatedTokens: number } {
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const chars = text.length;
  const lines = text.split('\n').length;
  const estimatedTokens = Math.ceil(words * 1.3); // rough estimate

  return { words, chars, lines, estimatedTokens };
}

// Test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testText = `
    The Federal Reserve announced today that it will maintain interest rates at current levels,
    citing ongoing concerns about inflation while acknowledging recent improvements in employment data.
    Fed Chair Jerome Powell stated that "we remain data-dependent" and that future decisions would
    be based on incoming economic indicators. Markets reacted positively to the news, with the S&P 500
    rising 1.2% in after-hours trading. Economists surveyed by Reuters expect the Fed to begin cutting
    rates in Q2 2025, though some analysts warn that persistent inflation could delay this timeline.
  `;

  console.log('Testing Gemini integration...\n');

  const metadata = getTextMetadata(testText);
  console.log('Text metadata:', metadata);

  console.log('\n--- Summarize ---');
  const summary = await summarize(testText);
  console.log(summary);

  console.log('\n--- Extract Facts ---');
  const facts = await extractFacts(testText, 'Fed decision, market reaction, rate cut expectations');
  console.log(facts);

  console.log('\n--- Analyze for Prediction ---');
  const analysis = await analyzeForPrediction(testText, 'Will the Fed cut rates in Q1 2025?');
  console.log(analysis);
}
