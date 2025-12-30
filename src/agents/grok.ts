/**
 * Grok/xAI Agent - Twitter + Web Intelligence Layer
 *
 * Uses xAI's agentic search tools for:
 * - X/Twitter search with handle filtering and engagement thresholds
 * - Web search with domain filtering
 * - News aggregation
 *
 * Pricing: $25 per 1,000 sources ($0.025/source)
 * Model: grok-4-1-fast (reasoning, 2M context, $0.20/$0.50 per million tokens)
 */

import 'dotenv/config';

const XAI_API_BASE = 'https://api.x.ai/v1';

interface GrokSearchParams {
  query: string;
  sources?: ('web' | 'x' | 'news')[];
  fromDate?: Date;
  toDate?: Date;
  maxResults?: number;
  // X-specific filters
  includedXHandles?: string[];
  excludedXHandles?: string[];
  postFavoriteCount?: number;
  postViewCount?: number;
  // Web-specific filters
  allowedDomains?: string[];
  excludedDomains?: string[];
}

interface GrokSearchResult {
  content: string;
  citations: string[];
  sourcesUsed: number;
  model: string;
}

// Note: Agentic search (grok-4-1-fast with tools) uses /v1/responses endpoint
// which requires xai-sdk. For now, using Live Search API which works great.
// TODO: Add agentic search when needed for more complex iterative queries.

/**
 * Perform live search using the legacy Live Search API
 * Simpler but still powerful - good for straightforward queries
 */
export async function grokLiveSearch(params: GrokSearchParams): Promise<GrokSearchResult> {
  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('XAI_API_KEY or GROK_API_KEY not set in environment');
  }

  // Build sources array
  const sourcesConfig: any[] = [];
  const sources = params.sources || ['web', 'x', 'news'];

  if (sources.includes('web')) {
    const webSource: any = { type: 'web' };
    if (params.allowedDomains?.length) {
      webSource.allowed_websites = params.allowedDomains;
    }
    if (params.excludedDomains?.length) {
      webSource.excluded_websites = params.excludedDomains;
    }
    sourcesConfig.push(webSource);
  }

  if (sources.includes('x')) {
    const xSource: any = { type: 'x' };
    if (params.includedXHandles?.length) {
      xSource.included_x_handles = params.includedXHandles;
    }
    if (params.excludedXHandles?.length) {
      xSource.excluded_x_handles = params.excludedXHandles;
    }
    if (params.postFavoriteCount) {
      xSource.post_favorite_count = params.postFavoriteCount;
    }
    if (params.postViewCount) {
      xSource.post_view_count = params.postViewCount;
    }
    sourcesConfig.push(xSource);
  }

  if (sources.includes('news')) {
    sourcesConfig.push({ type: 'news' });
  }

  const searchParams: any = {
    mode: 'on',
    return_citations: true,
    max_search_results: params.maxResults || 20
  };

  if (sourcesConfig.length > 0) {
    searchParams.sources = sourcesConfig;
  }

  if (params.fromDate) {
    searchParams.from_date = params.fromDate.toISOString().split('T')[0];
  }
  if (params.toDate) {
    searchParams.to_date = params.toDate.toISOString().split('T')[0];
  }

  const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-4',
      messages: [
        {
          role: 'system',
          content: `You are an intelligence analyst researching prediction markets. Provide factual, well-sourced information. Include specific data points, quotes, and sentiment where relevant.`
        },
        {
          role: 'user',
          content: params.query
        }
      ],
      search_parameters: searchParams,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
    sourcesUsed: data.usage?.num_sources_used || 0,
    model: 'grok-4'
  };
}

/**
 * Research a Polymarket topic using Twitter + Web intel
 * This is the main entry point for your research pipeline
 */
export async function researchTopic(
  topic: string,
  options: {
    focusOnTwitter?: boolean;
    dateRange?: { from: Date; to: Date };
    viralOnly?: boolean;  // Only high-engagement posts
    trackHandles?: string[];  // Specific accounts to monitor
  } = {}
): Promise<GrokSearchResult> {
  const params: GrokSearchParams = {
    query: `Research the following topic for prediction market analysis. Include:
- Current news and developments
- Twitter/X sentiment and insider opinions
- Key events or announcements
- Anything that could affect the outcome

Topic: ${topic}`,
    sources: options.focusOnTwitter ? ['x'] : ['web', 'x', 'news'],
    maxResults: 20
  };

  if (options.dateRange) {
    params.fromDate = options.dateRange.from;
    params.toDate = options.dateRange.to;
  }

  if (options.viralOnly) {
    params.postFavoriteCount = 1000;
    params.postViewCount = 20000;
  }

  if (options.trackHandles?.length) {
    params.includedXHandles = options.trackHandles;
  }

  return grokLiveSearch(params);
}

/**
 * Quick Twitter sentiment check on a topic
 */
export async function twitterSentiment(
  topic: string,
  daysBack: number = 7
): Promise<GrokSearchResult> {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);

  return grokLiveSearch({
    query: `What is Twitter/X saying about: ${topic}

Summarize:
- Overall sentiment (bullish/bearish/neutral)
- Key voices and their positions
- Any viral takes or insider info
- Notable disagreements or debates`,
    sources: ['x'],
    fromDate,
    toDate,
    postFavoriteCount: 100,  // Some engagement threshold
    maxResults: 15
  });
}
