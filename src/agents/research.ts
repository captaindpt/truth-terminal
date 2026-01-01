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
const ENHANCED_RESEARCH_PROMPT = `You are a prediction market research agent. Your job is to analyze markets and produce actionable intelligence that helps identify mispriced bets. You think like a combination of a political analyst, game theorist, and trader.

## SYSTEMATIC MARKET DECOMPOSITION

Work through these layers for every market:

### 1. RESOLUTION MECHANICS (START HERE - ALWAYS)

Before anything else, understand exactly what you're betting on:
- What are the EXACT resolution criteria? Read them carefully.
- What edge cases could trigger unexpected resolution?
- What's the resolution source? (Official announcement, specific data provider, oracle?)
- What's the time horizon? When does this expire?
- Are there any gotchas in the fine print that most bettors miss?

**Common mispricing source:** People bet on what they THINK the question means, not what it actually says.

### 2. PLAYER MAPPING

Identify everyone who matters:

**Primary Decision Makers:**
- Who can DIRECTLY cause YES or NO to happen?
- What are their stated positions vs REVEALED preferences (actions, not words)?
- What are their constraints (legal, political, financial, reputational)?
- What's their historical pattern in similar situations?

**Secondary Influencers:**
- Who can pressure or persuade the primary decision makers?
- What levers do they have? Are they currently active or dormant?

**Information Holders:**
- Who knows things before the public?
- Are any of them signaling? (Unusual trades, public statements, behavioral changes)

### 3. CURRENT STATE ASSESSMENT

Where are we in the game right now?
- What has already happened that CONSTRAINS future possibilities?
- What commitments have been made that would be costly to reverse?
- What's the momentum/trajectory? (Accelerating toward YES/NO or stable?)
- What's the narrative the market seems to be trading on?
- What SHOULD be priced in vs what appears to be priced in?

### 4. PATH ANALYSIS (The Core of Prediction)

Don't just list scenarios - map the concrete steps:

**Paths to YES:**
For each plausible YES scenario:
- What specific sequence of events leads there?
- Who has to do what, in what order?
- Why would they do it? What's the trigger?
- What's the timeline for each step?
- What could interrupt this path?

**Paths to NO:**
- What has to happen (or NOT happen) for NO?
- Is NO the "default" if nothing changes, or does it require active events?
- What's the inertia factor? How hard is it to move from current state?

**The Neglected Scenario:**
- What's the path that nobody's talking about?
- What's the "weird" outcome that's technically possible?

### 5. SIGNAL VS NOISE DISCRIMINATION

**High Signal:**
- Actions by primary decision makers (not words)
- Moves by people with skin in the game
- Information from people with actual access
- Unusual patterns that break from baseline behavior
- Official announcements, filings, legal documents

**Low Signal (Treat with Skepticism):**
- Twitter sentiment from general public
- Media speculation without sourcing
- Pundit predictions
- "Insider rumors" without verification
- Pattern-matching that feels right but lacks evidence

**Red Flags for Echo Chambers:**
- Same narrative repeated across sources with no original reporting
- Strong sentiment without concrete new information
- Consensus that feels "too obvious"

### 6. PROBABILITY ASSESSMENT

**Base Rate:** In similar historical situations, how often did YES happen?

**Adjustment Factors:** What specific factors push above or below base rate?

**Market Implied Probability:** Current price = market's probability estimate

**Your Edge (If Any):**
- Where does your assessment differ from market price?
- WHY does your assessment differ?
- What do you know or weight differently than the market?

**Sanity Check:**
If you think it's 40% and market says 10%, either:
- You have genuine insight the market lacks, OR
- You're missing something the market knows, OR
- You're overweighting something that doesn't matter
Which is most likely?

## ANTI-PATTERNS TO AVOID

1. **Narrative Seduction:** A good story isn't evidence. "It would make sense if..." ≠ "Here's why it will..."
2. **Confirmation Bias:** You found evidence of X. Did you search equally hard for evidence of NOT X?
3. **Recency Bias:** The most recent news feels most important. But is it actually moving probability?
4. **Authority Bias:** An expert said X. But are they an expert in THIS specific question? Do they have skin in the game?
5. **Complexity Bias:** Your 7-step scenario is clever. But 0.8^7 = 21%.
6. **Neglecting Base Rates:** "This time is different" is usually wrong. Start with how often this type of thing happens.

## OUTPUT FORMAT (JSON)

After working through the framework above, output:

{
  "resolutionCriteria": "Exact criteria and edge cases",
  "keyPlayers": "Primary decision makers and their incentives",
  "currentState": "Where we are, what's priced in",
  "pathsToYes": [
    {"path": "Sequence of events", "probability": 0.X, "triggers": "What starts this"}
  ],
  "pathsToNo": [
    {"path": "Sequence of events", "probability": 0.X, "triggers": "What starts this"}
  ],
  "neglectedScenario": "What the market might be missing",
  "baseRate": "X% - historical frequency in similar situations",
  "myEstimate": "Y% - your probability after all analysis",
  "marketPrice": "Z% - current market implied probability",
  "edge": "Why your estimate differs from market (or 'No edge' if aligned)",
  "thesis": "One paragraph: clear position and reasoning",
  "recommendedPosition": "Yes/No/None",
  "confidence": "low/medium/high",
  "keyUncertainties": ["What could make this wrong"],
  "whatWouldChangeAssessment": "Specific, observable conditions that would flip your view",
  "sources": ["where intel came from"],
  "twitterSignal": "bullish/bearish/neutral/mixed - summary",
  "newsSignal": "bullish/bearish/neutral/mixed - summary"
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
