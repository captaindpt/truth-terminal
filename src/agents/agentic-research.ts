/**
 * Agentic Research Agent
 *
 * A tool-using research agent that can:
 * - Decide what intel it needs
 * - Use Grok for Twitter/web/news search
 * - Use Gemini to process bulk text
 * - Maintain a scratchpad to build up analysis
 * - Make multiple passes to refine its thesis
 *
 * This replaces the single-shot research pipeline with an
 * iterative, thinking analyst.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { researchTopic, twitterSentiment } from './grok.js';
import { gemini, analyzeForPrediction, getTextMetadata } from './gemini.js';
import { fetchTranscript, getTranscriptPreview } from './youtube.js';
import {
  loadScratchpad,
  saveScratchpad,
  appendNotes,
  addFact,
  addSignal,
  addUncertainty,
  recordSource,
  updateHypothesis,
  setSynthesis,
  getScratchpadSummary,
  type Scratchpad
} from './scratchpad.js';
import type { PolymarketMarket, ResearchCase } from '../types/index.js';

const claude = new Anthropic();

// Tool definitions for the agent
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'grok_search',
    description: 'Search Twitter/X, web, and news for information. Use this to gather raw intelligence about a topic. Returns summaries and citations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query - be specific about what you want to find'
        },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['twitter', 'web', 'news'] },
          description: 'Which sources to search (default: all)'
        },
        focus: {
          type: 'string',
          description: 'Optional: specific angle to focus on (e.g., "insider opinions", "recent developments", "contrarian views")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'gemini_process',
    description: 'Process large amounts of text with Gemini. Use this for bulk text that would be expensive to process with Claude. Good for: summarizing long documents, extracting specific facts, analyzing transcripts. You will be told the size of the text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'The text to process'
        },
        instruction: {
          type: 'string',
          description: 'What to do with the text (summarize, extract facts, analyze for prediction, etc.)'
        }
      },
      required: ['text', 'instruction']
    }
  },
  {
    name: 'youtube_transcript',
    description: 'Fetch the transcript of a YouTube video. Returns the full text of what was said.',
    input_schema: {
      type: 'object' as const,
      properties: {
        video_id: {
          type: 'string',
          description: 'YouTube video ID (the part after v= in the URL)'
        }
      },
      required: ['video_id']
    }
  },
  {
    name: 'scratchpad_read',
    description: 'Read your current scratchpad - see what facts, signals, uncertainties, and hypotheses you have gathered so far.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'scratchpad_add_fact',
    description: 'Add a verified fact to your scratchpad. Facts should be concrete, verifiable information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to record'
        }
      },
      required: ['fact']
    }
  },
  {
    name: 'scratchpad_add_signal',
    description: 'Add a signal/indicator to your scratchpad. Signals are trends or indicators that suggest direction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        signal: {
          type: 'string',
          description: 'The signal to record'
        }
      },
      required: ['signal']
    }
  },
  {
    name: 'scratchpad_add_uncertainty',
    description: 'Add an uncertainty/open question to your scratchpad.',
    input_schema: {
      type: 'object' as const,
      properties: {
        uncertainty: {
          type: 'string',
          description: 'The uncertainty or open question'
        }
      },
      required: ['uncertainty']
    }
  },
  {
    name: 'scratchpad_note',
    description: 'Add free-form notes to your scratchpad. Use this for thinking out loud, recording hypotheses, or noting observations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        note: {
          type: 'string',
          description: 'Your note'
        }
      },
      required: ['note']
    }
  },
  {
    name: 'update_hypothesis',
    description: 'Update your working hypothesis for a position (Yes or No). Track evidence and counter-evidence.',
    input_schema: {
      type: 'object' as const,
      properties: {
        position: {
          type: 'string',
          enum: ['yes', 'no'],
          description: 'Which position this hypothesis is for'
        },
        thesis: {
          type: 'string',
          description: 'Your current thesis for this position'
        },
        confidence: {
          type: 'number',
          description: 'Confidence 0-100'
        },
        new_evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'New evidence supporting this hypothesis'
        },
        new_counter_evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'New evidence against this hypothesis'
        }
      },
      required: ['position', 'thesis', 'confidence']
    }
  },
  {
    name: 'finalize_research',
    description: 'Finalize your research and produce the final case. Only call this when you have gathered enough information and are ready to commit to a recommendation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        recommended_position: {
          type: 'string',
          enum: ['yes', 'no', 'none'],
          description: 'Your recommended position'
        },
        confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Your confidence level'
        },
        thesis: {
          type: 'string',
          description: 'Your final thesis - clear statement of what will happen and why'
        },
        edge: {
          type: 'string',
          description: 'What edge do you have? What is the market missing?'
        },
        key_risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key risks to this thesis'
        },
        what_would_flip: {
          type: 'string',
          description: 'What specific observable conditions would flip your call?'
        }
      },
      required: ['recommended_position', 'confidence', 'thesis', 'edge', 'key_risks', 'what_would_flip']
    }
  }
];

// The system prompt that teaches the agent how to think about prediction markets
const AGENT_SYSTEM_PROMPT = `You are an elite prediction market research analyst. Your job is to build a comprehensive research case for a specific market.

## Your Mission
You need to find EDGE - information asymmetry the market hasn't priced in. Not just "what will happen" but "what does the market NOT know that I now know."

## How to Work

1. **Understand the market first**: What exactly resolves this? What's the deadline? What are the edge cases?

2. **Gather intelligence systematically**:
   - Use grok_search for Twitter sentiment, news, and web research
   - If you get large text (transcripts, long articles), use gemini_process to extract key info
   - Record facts, signals, and uncertainties as you go

3. **Build hypotheses for both sides**:
   - What's the case for YES?
   - What's the case for NO?
   - Track evidence and counter-evidence for each

4. **Look for edge**:
   - Is there recent news the market hasn't absorbed?
   - Is Twitter sentiment diverging from the price?
   - Are insiders saying something different from the crowd?
   - Is there a catalyst coming that people are ignoring?

5. **Be calibrated**:
   - HIGH confidence: Clear edge, multiple confirming signals, actionable
   - MEDIUM confidence: Good thesis but uncertainty, moderate position
   - LOW confidence: Speculative, conflicting signals, pass or tiny position

## Important Notes

- The scratchpad persists - use it to build up your analysis
- Don't just summarize - ANALYZE. What does this MEAN for the market?
- Be paranoid about your thesis - what could blow it up?
- If you don't have edge, say so. "No clear edge" is a valid conclusion.

## When to Finalize

Call finalize_research when:
- You've done 2-4 searches from different angles
- You have at least 2-3 facts recorded
- You have a working thesis

IMPORTANT: You have a LIMITED number of tool calls (typically 10-15). Don't be a perfectionist - gather key intel quickly, then finalize. Better to have a decent thesis with some evidence than to run out of turns gathering endless data.

After 6-8 tool calls, start wrapping up and call finalize_research.`;

interface AgentState {
  scratchpad: Scratchpad;
  messages: Anthropic.MessageParam[];
  toolCallCount: number;
  maxToolCalls: number;
  finalized: boolean;
  thinkingLog: string[]; // Store thinking blocks for review
  transcript: string[];  // Full conversation transcript for logging
  finalResult?: {
    recommended_position: string;
    confidence: string;
    thesis: string;
    edge: string;
    key_risks: string[];
    what_would_flip: string;
  };
}

interface AgenticResearchOptions {
  maxToolCalls?: number;
  verbose?: boolean;
  enableThinking?: boolean;  // Enable extended thinking mode
  thinkingBudget?: number;   // Token budget for thinking (default 10000)
  model?: 'sonnet' | 'opus'; // Which model to use
}

/**
 * Format a transcript entry with clear visual separation
 */
function logTranscript(transcript: string[], role: string, content: string): void {
  const divider = '─'.repeat(60);
  const timestamp = new Date().toISOString().slice(11, 19);
  transcript.push(`\n${divider}\n[${timestamp}] ${role}\n${divider}\n\n${content}\n`);
}

/**
 * Handle a tool call from the agent
 */
async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  state: AgentState
): Promise<string> {
  switch (toolName) {
    case 'grok_search': {
      const query = toolInput.query as string;
      const focus = toolInput.focus as string | undefined;
      const searchQuery = focus ? `${query} (focus: ${focus})` : query;

      try {
        // Try full research first
        const result = await researchTopic(searchQuery, {});
        recordSource(state.scratchpad, {
          type: 'grok',
          query: searchQuery,
          summary: `Found ${result.citations.length} sources`
        });

        const metadata = getTextMetadata(result.content);
        return `Search results (${metadata.words} words, ${result.citations.length} sources):\n\n${result.content}\n\nSources: ${result.citations.slice(0, 10).join(', ')}`;
      } catch (err) {
        // Fallback to Twitter only
        try {
          const twitterResult = await twitterSentiment(query, 7);
          recordSource(state.scratchpad, {
            type: 'grok',
            query: `${searchQuery} (twitter only)`,
            summary: `Twitter sentiment`
          });
          return `Twitter sentiment:\n\n${twitterResult.content}`;
        } catch (e) {
          return `Search failed: ${(err as Error).message}. Try a different query.`;
        }
      }
    }

    case 'gemini_process': {
      const text = toolInput.text as string;
      const instruction = toolInput.instruction as string;

      try {
        const result = await gemini({ text, instruction });
        recordSource(state.scratchpad, {
          type: 'gemini',
          query: instruction,
          summary: `Processed ${result.tokenCount.input} tokens`
        });
        return result.result;
      } catch (err) {
        return `Gemini processing failed: ${(err as Error).message}`;
      }
    }

    case 'youtube_transcript': {
      const videoId = toolInput.video_id as string;

      try {
        const transcript = await fetchTranscript(videoId);
        const preview = getTranscriptPreview(transcript, 5000);
        const metadata = getTextMetadata(transcript.fullText);

        recordSource(state.scratchpad, {
          type: 'youtube',
          url: transcript.url,
          summary: `${metadata.words} words`
        });

        return `YouTube transcript (${metadata.words} words total, showing first ~5000 chars):\n\nTitle: ${transcript.title}\nChannel: ${transcript.channel}\n\n${preview}\n\n[Note: Full transcript is ${metadata.words} words. Use gemini_process if you need to analyze the full thing.]`;
      } catch (err) {
        return `Failed to fetch transcript: ${(err as Error).message}`;
      }
    }

    case 'scratchpad_read': {
      return getScratchpadSummary(state.scratchpad);
    }

    case 'scratchpad_add_fact': {
      const fact = toolInput.fact as string;
      addFact(state.scratchpad, fact);
      return `Fact recorded: "${fact}"`;
    }

    case 'scratchpad_add_signal': {
      const signal = toolInput.signal as string;
      addSignal(state.scratchpad, signal);
      return `Signal recorded: "${signal}"`;
    }

    case 'scratchpad_add_uncertainty': {
      const uncertainty = toolInput.uncertainty as string;
      addUncertainty(state.scratchpad, uncertainty);
      return `Uncertainty recorded: "${uncertainty}"`;
    }

    case 'scratchpad_note': {
      const note = toolInput.note as string;
      appendNotes(state.scratchpad, note);
      return `Note added to scratchpad.`;
    }

    case 'update_hypothesis': {
      const position = toolInput.position as 'yes' | 'no';
      const thesis = toolInput.thesis as string;
      const confidence = toolInput.confidence as number;
      const newEvidence = toolInput.new_evidence as string[] | undefined;
      const newCounterEvidence = toolInput.new_counter_evidence as string[] | undefined;

      updateHypothesis(state.scratchpad, position, thesis, confidence, newEvidence, newCounterEvidence);
      return `Hypothesis for ${position.toUpperCase()} updated: "${thesis}" (${confidence}% confidence)`;
    }

    case 'finalize_research': {
      state.finalized = true;
      state.finalResult = {
        recommended_position: toolInput.recommended_position as string,
        confidence: toolInput.confidence as string,
        thesis: toolInput.thesis as string,
        edge: toolInput.edge as string,
        key_risks: toolInput.key_risks as string[],
        what_would_flip: toolInput.what_would_flip as string
      };

      setSynthesis(state.scratchpad, {
        recommendedPosition: toolInput.recommended_position as 'yes' | 'no',
        confidence: toolInput.confidence as 'low' | 'medium' | 'high',
        thesis: toolInput.thesis as string,
        keyRisks: toolInput.key_risks as string[],
        whatWouldFlip: toolInput.what_would_flip as string
      });

      return `Research finalized. Position: ${toolInput.recommended_position}, Confidence: ${toolInput.confidence}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

/**
 * Run the agentic research loop
 */
export async function agenticResearch(
  market: PolymarketMarket,
  options: AgenticResearchOptions = {}
): Promise<ResearchCase> {
  const {
    maxToolCalls = 15,
    verbose = true,
    enableThinking = true,  // Default ON - we want the agent to think
    thinkingBudget = 10000, // 10k tokens for thinking per turn
    model = 'opus'          // Default to Opus 4.5 for better reasoning
  } = options;

  const modelId = model === 'opus'
    ? 'claude-opus-4-20250514'
    : 'claude-sonnet-4-20250514';

  // Initialize scratchpad
  const scratchpad = loadScratchpad(market.id, market.question);

  // Build initial context
  const marketContext = `
## Market to Research

**Question**: ${market.question}

**Description**: ${market.description}

**Outcomes**: ${market.outcomes.join(' vs ')}

**Current Prices**: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] * 100).toFixed(1)}%`).join(', ')}

**Volume**: $${market.volume.toLocaleString()}
**Liquidity**: $${market.liquidity.toLocaleString()}
**End Date**: ${market.endDate}
**Category**: ${market.category}

---

Begin your research. Use the tools to gather intelligence, record findings in your scratchpad, and build your thesis. When you have enough information, call finalize_research.`;

  const state: AgentState = {
    scratchpad,
    messages: [{ role: 'user', content: marketContext }],
    toolCallCount: 0,
    maxToolCalls,
    finalized: false,
    thinkingLog: [],
    transcript: []
  };

  // Log the system prompt and initial context to transcript
  logTranscript(state.transcript, '📋 SYSTEM PROMPT', AGENT_SYSTEM_PROMPT);
  logTranscript(state.transcript, '📨 USER (Market Context)', marketContext);

  if (verbose) {
    console.log('🔬 Starting agentic research...');
    console.log(`   Market: ${market.question}`);
    console.log(`   Model: ${modelId}${enableThinking ? ` (thinking: ${thinkingBudget} tokens)` : ''}`);
    console.log(`   Max tool calls: ${maxToolCalls}`);
    console.log(`   (Full transcript will be saved to data/transcripts/)`);
  }

  // Agent loop
  while (!state.finalized && state.toolCallCount < maxToolCalls) {
    // Build request with optional extended thinking
    const requestParams: Anthropic.MessageCreateParams = {
      model: modelId,
      max_tokens: enableThinking ? 16000 : 4096, // Need higher max for thinking
      system: AGENT_SYSTEM_PROMPT,
      tools: TOOLS,
      messages: state.messages
    };

    // Add thinking configuration if enabled
    if (enableThinking) {
      (requestParams as any).thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget
      };
    }

    // Use streaming for Opus with thinking (required for long operations)
    let response: Anthropic.Message;
    if (enableThinking && model === 'opus') {
      // Stream the response and collect it
      const stream = await claude.messages.stream(requestParams);
      response = await stream.finalMessage();
    } else {
      response = await claude.messages.create(requestParams);
    }

    // Process response
    const assistantContent: Anthropic.ContentBlock[] = [];
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let turnTranscript: string[] = []; // Collect this turn's content

    for (const block of response.content) {
      assistantContent.push(block);

      // Handle thinking blocks (extended thinking mode)
      if (block.type === 'thinking') {
        const thinkingText = (block as any).thinking || '';
        state.thinkingLog.push(thinkingText);

        // Log FULL thinking to transcript
        turnTranscript.push(`**🧠 THINKING:**\n\n${thinkingText}`);

        if (verbose) {
          // Show preview in console
          const preview = thinkingText.slice(0, 300).replace(/\n/g, ' ');
          console.log(`\n🧠 [Thinking]: ${preview}...`);
        }
      }

      // Handle regular text output
      if (block.type === 'text') {
        turnTranscript.push(`**💬 SPEAKING:**\n\n${block.text}`);
        if (verbose) {
          console.log(`\n💬 Agent: ${block.text.slice(0, 200)}...`);
        }
      }

      if (block.type === 'tool_use') {
        state.toolCallCount++;
        const toolInput = block.input as Record<string, unknown>;

        // Log tool call to transcript
        turnTranscript.push(`**🔧 TOOL CALL [${state.toolCallCount}/${maxToolCalls}]: ${block.name}**\n\nInput:\n\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``);

        if (verbose) {
          console.log(`\n🔧 Tool [${state.toolCallCount}/${maxToolCalls}]: ${block.name}`);
          if (block.name === 'grok_search') {
            console.log(`   Query: ${toolInput.query}`);
          }
        }

        const result = await handleToolCall(
          block.name,
          toolInput,
          state
        );

        // Log tool result to transcript
        const resultPreview = result.length > 2000
          ? result.slice(0, 2000) + `\n\n... [truncated, ${result.length} chars total]`
          : result;
        turnTranscript.push(`**📥 TOOL RESULT: ${block.name}**\n\n${resultPreview}`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result
        });
      }
    }

    // Log this turn to transcript
    if (turnTranscript.length > 0) {
      logTranscript(state.transcript, `🤖 ASSISTANT (Turn ${state.toolCallCount})`, turnTranscript.join('\n\n---\n\n'));
    }

    // Add assistant message
    state.messages.push({ role: 'assistant', content: assistantContent });

    // Add tool results if any
    if (toolResults.length > 0) {
      state.messages.push({ role: 'user', content: toolResults });
    }

    // Check if we're done
    if (response.stop_reason === 'end_turn' && state.finalized) {
      break;
    }

    // Safety valve - if no tool calls and not finalized, prompt to continue
    if (response.stop_reason === 'end_turn' && !state.finalized && toolResults.length === 0) {
      state.messages.push({
        role: 'user',
        content: 'Continue your research. Use the tools to gather more information, or call finalize_research if you have enough.'
      });
    }

    // Nudge to finalize when approaching limit
    if (state.toolCallCount >= maxToolCalls - 3 && !state.finalized) {
      state.messages.push({
        role: 'user',
        content: `You have ${maxToolCalls - state.toolCallCount} tool calls remaining. Time to wrap up - call finalize_research with your best thesis based on what you've gathered.`
      });
    }
  }

  // Build the research case
  if (!state.finalResult) {
    // Agent didn't finalize - extract what we can from scratchpad
    const hypothesis = state.scratchpad.hypotheses.sort((a, b) => b.confidence - a.confidence)[0];

    state.finalResult = {
      recommended_position: hypothesis?.position || 'none',
      confidence: hypothesis?.confidence > 70 ? 'high' : hypothesis?.confidence > 40 ? 'medium' : 'low',
      thesis: hypothesis?.thesis || 'Research incomplete - no clear thesis developed',
      edge: 'Research did not complete - edge unclear',
      key_risks: state.scratchpad.uncertainties.slice(0, 5),
      what_would_flip: 'More research needed'
    };
  }

  // Log final result to transcript
  logTranscript(state.transcript, '✅ FINAL RESULT', `
**Recommended Position:** ${state.finalResult.recommended_position.toUpperCase()}
**Confidence:** ${state.finalResult.confidence.toUpperCase()}

**Thesis:**
${state.finalResult.thesis}

**Edge:**
${state.finalResult.edge}

**Key Risks:**
${Array.isArray(state.finalResult.key_risks) ? state.finalResult.key_risks.map(r => `- ${r}`).join('\n') : state.finalResult.key_risks}

**What Would Flip:**
${state.finalResult.what_would_flip}
`);

  // Save full transcript to file
  const transcriptDir = 'data/transcripts';
  if (!existsSync(transcriptDir)) {
    mkdirSync(transcriptDir, { recursive: true });
  }

  const transcriptHeader = `# Agent Research Transcript

**Market:** ${market.question}
**Market ID:** ${market.id}
**Model:** ${modelId}
**Thinking Enabled:** ${enableThinking} (budget: ${thinkingBudget} tokens)
**Max Tool Calls:** ${maxToolCalls}
**Started:** ${new Date().toISOString()}
**Tool Calls Used:** ${state.toolCallCount}
**Thinking Blocks:** ${state.thinkingLog.length}

---
`;

  const transcriptContent = transcriptHeader + state.transcript.join('');
  const transcriptPath = `${transcriptDir}/${market.id}_${Date.now()}.md`;
  writeFileSync(transcriptPath, transcriptContent);

  if (verbose) {
    console.log(`\n✅ Research complete`);
    console.log(`   Model: ${modelId}`);
    console.log(`   Tool calls: ${state.toolCallCount}`);
    console.log(`   Thinking blocks: ${state.thinkingLog.length}`);
    console.log(`   Position: ${state.finalResult.recommended_position}`);
    console.log(`   Confidence: ${state.finalResult.confidence}`);
    console.log(`   📄 Full transcript: ${transcriptPath}`);
  }

  const thinkingEnabled = enableThinking ? ' + thinking' : '';

  return {
    marketId: market.id,
    market,
    thesis: `${state.finalResult.thesis}\n\nEdge: ${state.finalResult.edge}`,
    recommendedPosition: state.finalResult.recommended_position.charAt(0).toUpperCase() +
      state.finalResult.recommended_position.slice(1) as 'Yes' | 'No' | 'None',
    confidence: state.finalResult.confidence as 'low' | 'medium' | 'high',
    keyUncertainties: state.finalResult.key_risks,
    whatWouldChangeAssessment: state.finalResult.what_would_flip,
    sources: state.scratchpad.sources.map(s => s.url || s.query || s.type),
    createdAt: new Date().toISOString(),
    agentModel: `${modelId} (agentic${thinkingEnabled})`
  };
}
