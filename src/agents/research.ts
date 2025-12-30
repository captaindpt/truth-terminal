/**
 * Multi-Source Research Agent
 *
 * Orchestrates multiple intel sources to build comprehensive research cases:
 * - Claude: Analysis and synthesis
 * - Grok: Twitter/X sentiment + web/news search
 * - YouTube: Video transcript analysis
 *
 * This is the core of Phase 2+: automated research at scale.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { researchTopic, twitterSentiment, type GrokSearchResult } from './grok.js';
import { fetchTranscript, getTranscriptPreview, type VideoTranscript } from './youtube.js';
import type { PolymarketMarket, ResearchCase } from '../types/index.js';

const claude = new Anthropic();

interface ResearchConfig {
  // Which sources to use
  useGrok?: boolean;
  useTwitter?: boolean;
  useYouTube?: boolean;
  youtubeVideos?: string[];  // Specific videos to analyze

  // Grok settings
  grokDateRange?: { from: Date; to: Date };
  trackHandles?: string[];
  viralOnly?: boolean;

  // Model settings
  researchModel?: 'claude-sonnet-4-20250514' | 'claude-opus-4-20250514';
}

interface MultiSourceIntel {
  grokResearch?: GrokSearchResult;
  twitterSentiment?: GrokSearchResult;
  youtubeTranscripts?: VideoTranscript[];
  rawContext: string;
}

/**
 * Gather intel from multiple sources
 */
async function gatherIntel(
  topic: string,
  config: ResearchConfig
): Promise<MultiSourceIntel> {
  const intel: MultiSourceIntel = { rawContext: '' };
  const contextParts: string[] = [];

  // Parallel fetch from all enabled sources
  const promises: Promise<void>[] = [];

  if (config.useGrok !== false) {
    promises.push(
      researchTopic(topic, {
        dateRange: config.grokDateRange,
        trackHandles: config.trackHandles,
        viralOnly: config.viralOnly
      }).then(result => {
        intel.grokResearch = result;
        contextParts.push(`=== WEB + NEWS RESEARCH ===\n${result.content}\n\nSources: ${result.citations.join(', ')}`);
      }).catch(err => {
        console.warn('Grok research failed:', err.message);
      })
    );
  }

  if (config.useTwitter !== false) {
    promises.push(
      twitterSentiment(topic, 7).then(result => {
        intel.twitterSentiment = result;
        contextParts.push(`=== TWITTER/X SENTIMENT ===\n${result.content}\n\nSources: ${result.citations.join(', ')}`);
      }).catch(err => {
        console.warn('Twitter sentiment failed:', err.message);
      })
    );
  }

  if (config.useYouTube && config.youtubeVideos?.length) {
    promises.push(
      Promise.all(
        config.youtubeVideos.map(v => fetchTranscript(v).catch(() => null))
      ).then(results => {
        intel.youtubeTranscripts = results.filter((r): r is VideoTranscript => r !== null);
        if (intel.youtubeTranscripts.length > 0) {
          const transcriptContext = intel.youtubeTranscripts
            .map(t => `[Video: ${t.url}]\n${getTranscriptPreview(t, 3000)}`)
            .join('\n\n');
          contextParts.push(`=== YOUTUBE TRANSCRIPTS ===\n${transcriptContext}`);
        }
      }).catch(err => {
        console.warn('YouTube transcripts failed:', err.message);
      })
    );
  }

  await Promise.all(promises);

  intel.rawContext = contextParts.join('\n\n');
  return intel;
}

/**
 * The enhanced research prompt that produces structured cases
 */
const ENHANCED_RESEARCH_PROMPT = `You are an elite prediction market analyst. You've been given intelligence from multiple sources about a market. Your job is to synthesize this into an actionable research case.

CRITICAL: You are looking for EDGE - information asymmetry that the market hasn't priced in. Not just "what will happen" but "what does the market NOT know that I now know."

Your analysis should cover:

1. THESIS: What will happen and WHY. Be specific. Not "probably yes" but "X will happen because of Y, which the market is underweighting."

2. EDGE IDENTIFICATION: Where is the market wrong? What information is not priced in?
   - Is there recent news the market hasn't absorbed?
   - Is Twitter sentiment diverging from market price?
   - Are insiders saying something different from the crowd?

3. CONFIDENCE CALIBRATION:
   - HIGH: Clear edge, multiple confirming signals, actionable
   - MEDIUM: Good thesis but some uncertainty, moderate position
   - LOW: Speculative, conflicting signals, pass or tiny position

4. RISK FACTORS: What could blow up this thesis? Be paranoid.

5. WHAT WOULD FLIP YOUR CALL: Specific, observable conditions.

Output as JSON:
{
  "thesis": "Clear statement of position and reasoning",
  "edge": "What the market is missing",
  "recommendedPosition": "Yes/No/None",
  "confidence": "low/medium/high",
  "keyUncertainties": ["list", "of", "risks"],
  "whatWouldChangeAssessment": "Specific conditions",
  "sources": ["where this intel came from"],
  "twitterSignal": "bullish/bearish/neutral/mixed - summary of X sentiment",
  "newsSignal": "bullish/bearish/neutral/mixed - summary of recent news"
}`;

/**
 * Run comprehensive research on a market
 */
export async function researchMarket(
  market: PolymarketMarket,
  config: ResearchConfig = {}
): Promise<ResearchCase> {
  const topic = `${market.question}\n\nContext: ${market.description}`;

  console.log('📡 Gathering intel from multiple sources...');
  const intel = await gatherIntel(topic, config);

  if (!intel.rawContext) {
    throw new Error('No intel gathered from any source');
  }

  console.log('🧠 Synthesizing research case with Claude...');

  const marketContext = `
MARKET TO ANALYZE:
Question: ${market.question}
Description: ${market.description}
Outcomes: ${market.outcomes.join(' vs ')}
Current Prices: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] * 100).toFixed(1)}%`).join(', ')}
Volume: $${market.volume.toLocaleString()}
Liquidity: $${market.liquidity.toLocaleString()}
End Date: ${market.endDate}
Category: ${market.category}

=== GATHERED INTELLIGENCE ===
${intel.rawContext}

Now synthesize this into a research case. Focus on finding EDGE - what is the market missing?`;

  const response = await claude.messages.create({
    model: config.researchModel || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: ENHANCED_RESEARCH_PROMPT,
    messages: [{ role: 'user', content: marketContext }]
  });

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
    sources: [
      ...(intel.grokResearch?.citations || []),
      ...(intel.twitterSentiment?.citations || []),
      ...(intel.youtubeTranscripts?.map(t => t.url) || [])
    ],
    createdAt: new Date().toISOString(),
    agentModel: config.researchModel || 'claude-sonnet-4-20250514'
  };
}

/**
 * Quick research - just Grok + Claude, no YouTube
 */
export async function quickResearch(market: PolymarketMarket): Promise<ResearchCase> {
  return researchMarket(market, {
    useGrok: true,
    useTwitter: true,
    useYouTube: false
  });
}

/**
 * Deep research - all sources, viral tweets only, last 7 days
 */
export async function deepResearch(
  market: PolymarketMarket,
  youtubeVideos?: string[]
): Promise<ResearchCase> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return researchMarket(market, {
    useGrok: true,
    useTwitter: true,
    useYouTube: !!youtubeVideos?.length,
    youtubeVideos,
    grokDateRange: { from: weekAgo, to: now },
    viralOnly: true,
    researchModel: 'claude-sonnet-4-20250514'
  });
}
