import Anthropic from '@anthropic-ai/sdk';
import type { PolymarketMarket, ResearchCase } from '../types/index.js';

const client = new Anthropic();

// The core research prompt - this is what we iterate on in Phase 0
const RESEARCH_SYSTEM_PROMPT = `You are a prediction market research analyst. Your job is to analyze markets and build cases for or against specific positions.

You will be given a prediction market with a question, current prices, and context. Your task is to:

1. Analyze the available information
2. Form a thesis on what will happen and why
3. Identify which outcome represents value (if any)
4. Be explicit about what you don't know
5. State what would change your assessment

Be direct. No hedging language. State your actual view.

Your output must be structured JSON matching this format:
{
  "thesis": "Clear statement of what you believe will happen and why",
  "recommendedPosition": "The outcome you'd bet on, or 'none' if no edge",
  "confidence": "low" | "medium" | "high",
  "keyUncertainties": ["List of things that could invalidate your thesis"],
  "whatWouldChangeAssessment": "Specific conditions that would flip your call",
  "sources": ["Reasoning sources - could be 'training data', 'logical inference', etc"]
}`;

export async function analyzeMarket(
  market: PolymarketMarket,
  additionalContext?: string
): Promise<ResearchCase> {
  const marketPrompt = `
MARKET TO ANALYZE:
Question: ${market.question}
Description: ${market.description}
Outcomes: ${market.outcomes.join(' vs ')}
Current Prices: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] * 100).toFixed(1)}%`).join(', ')}
Volume: $${market.volume.toLocaleString()}
Liquidity: $${market.liquidity.toLocaleString()}
End Date: ${market.endDate}
Category: ${market.category}

${additionalContext ? `ADDITIONAL CONTEXT:\n${additionalContext}` : ''}

Analyze this market and provide your assessment as JSON.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',  // Sonnet for research, Opus for orchestrator
    max_tokens: 1024,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: marketPrompt }]
  });

  // Extract the text content
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse the JSON response
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from response: ' + textBlock.text);
  }

  const analysis = JSON.parse(jsonMatch[0]);

  return {
    marketId: market.id,
    market,
    thesis: analysis.thesis,
    recommendedPosition: analysis.recommendedPosition,
    confidence: analysis.confidence,
    keyUncertainties: analysis.keyUncertainties,
    whatWouldChangeAssessment: analysis.whatWouldChangeAssessment,
    sources: analysis.sources,
    createdAt: new Date().toISOString(),
    agentModel: 'claude-sonnet-4-20250514'
  };
}

// For the orchestrator layer - uses Opus for better judgment
export async function orchestratorQuery(
  userQuery: string,
  context: string
): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',  // Can upgrade to Opus when needed
    max_tokens: 2048,
    system: `You are the orchestrator for a prediction market research system. You help the user understand research cases, answer questions about specific markets, and dispatch deeper research when needed.

Be concise. The user is reviewing many cases and needs efficient answers.`,
    messages: [
      { role: 'user', content: `Context:\n${context}\n\nUser query: ${userQuery}` }
    ]
  });

  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}
