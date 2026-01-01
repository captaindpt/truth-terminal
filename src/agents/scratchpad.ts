/**
 * Scratchpad - Per-Market Memory System
 *
 * Each market gets a workspace where the research agent can:
 * - Store intermediate findings
 * - Build up structured notes across multiple passes
 * - Track what sources have been consulted
 * - Record hypotheses and their evidence
 *
 * Persisted to disk so research can be resumed/extended.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const SCRATCHPAD_DIR = 'data/scratchpads';

interface SourceRecord {
  type: 'grok' | 'youtube' | 'gemini' | 'web' | 'manual';
  query?: string;
  url?: string;
  timestamp: string;
  summary?: string;
}

interface Hypothesis {
  position: 'yes' | 'no';
  thesis: string;
  confidence: number; // 0-100
  evidence: string[];
  counterEvidence: string[];
  addedAt: string;
  updatedAt: string;
}

interface Scratchpad {
  marketId: string;
  marketQuestion: string;
  createdAt: string;
  updatedAt: string;

  // Raw notes - free-form thinking space
  notes: string;

  // Structured data
  facts: string[];           // Verified facts relevant to the market
  signals: string[];         // Indicators/trends
  uncertainties: string[];   // Open questions
  sources: SourceRecord[];   // What's been consulted

  // Hypotheses being developed
  hypotheses: Hypothesis[];

  // Final synthesis (filled when research is "done")
  synthesis?: {
    recommendedPosition: 'yes' | 'no';
    confidence: 'low' | 'medium' | 'high';
    thesis: string;
    keyRisks: string[];
    whatWouldFlip: string;
  };
}

function getScratchpadPath(marketId: string): string {
  return join(SCRATCHPAD_DIR, `${marketId}.json`);
}

/**
 * Create or load a scratchpad for a market
 */
export function loadScratchpad(marketId: string, marketQuestion: string): Scratchpad {
  const path = getScratchpadPath(marketId);

  if (existsSync(path)) {
    const data = readFileSync(path, 'utf-8');
    return JSON.parse(data);
  }

  // Create new scratchpad
  const scratchpad: Scratchpad = {
    marketId,
    marketQuestion,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: '',
    facts: [],
    signals: [],
    uncertainties: [],
    sources: [],
    hypotheses: [],
  };

  saveScratchpad(scratchpad);
  return scratchpad;
}

/**
 * Save scratchpad to disk
 */
export function saveScratchpad(scratchpad: Scratchpad): void {
  if (!existsSync(SCRATCHPAD_DIR)) {
    mkdirSync(SCRATCHPAD_DIR, { recursive: true });
  }

  scratchpad.updatedAt = new Date().toISOString();
  const path = getScratchpadPath(scratchpad.marketId);
  writeFileSync(path, JSON.stringify(scratchpad, null, 2));
}

/**
 * Append to notes
 */
export function appendNotes(scratchpad: Scratchpad, note: string): void {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  scratchpad.notes += `\n[${timestamp}]\n${note}\n`;
  saveScratchpad(scratchpad);
}

/**
 * Add a fact
 */
export function addFact(scratchpad: Scratchpad, fact: string): void {
  if (!scratchpad.facts.includes(fact)) {
    scratchpad.facts.push(fact);
    saveScratchpad(scratchpad);
  }
}

/**
 * Add a signal
 */
export function addSignal(scratchpad: Scratchpad, signal: string): void {
  if (!scratchpad.signals.includes(signal)) {
    scratchpad.signals.push(signal);
    saveScratchpad(scratchpad);
  }
}

/**
 * Add an uncertainty
 */
export function addUncertainty(scratchpad: Scratchpad, uncertainty: string): void {
  if (!scratchpad.uncertainties.includes(uncertainty)) {
    scratchpad.uncertainties.push(uncertainty);
    saveScratchpad(scratchpad);
  }
}

/**
 * Record a source that was consulted
 */
export function recordSource(scratchpad: Scratchpad, source: Omit<SourceRecord, 'timestamp'>): void {
  scratchpad.sources.push({
    ...source,
    timestamp: new Date().toISOString(),
  });
  saveScratchpad(scratchpad);
}

/**
 * Add or update a hypothesis
 */
export function updateHypothesis(
  scratchpad: Scratchpad,
  position: 'yes' | 'no',
  thesis: string,
  confidence: number,
  evidence?: string[],
  counterEvidence?: string[]
): void {
  const existing = scratchpad.hypotheses.find(h => h.position === position);

  if (existing) {
    existing.thesis = thesis;
    existing.confidence = confidence;
    // Ensure arrays exist (defensive against corrupted data)
    if (!Array.isArray(existing.evidence)) existing.evidence = [];
    if (!Array.isArray(existing.counterEvidence)) existing.counterEvidence = [];
    if (evidence) existing.evidence.push(...evidence);
    if (counterEvidence) existing.counterEvidence.push(...counterEvidence);
    existing.updatedAt = new Date().toISOString();
  } else {
    scratchpad.hypotheses.push({
      position,
      thesis,
      confidence,
      evidence: evidence || [],
      counterEvidence: counterEvidence || [],
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  saveScratchpad(scratchpad);
}

/**
 * Set final synthesis
 */
export function setSynthesis(
  scratchpad: Scratchpad,
  synthesis: Scratchpad['synthesis']
): void {
  scratchpad.synthesis = synthesis;
  saveScratchpad(scratchpad);
}

/**
 * Get a summary of the scratchpad for the agent
 * This is what the agent "sees" about its current state
 */
export function getScratchpadSummary(scratchpad: Scratchpad): string {
  const lines: string[] = [
    `=== SCRATCHPAD: ${scratchpad.marketQuestion} ===`,
    `Market ID: ${scratchpad.marketId}`,
    `Last updated: ${scratchpad.updatedAt}`,
    '',
  ];

  if (scratchpad.facts.length > 0) {
    lines.push(`FACTS (${scratchpad.facts.length}):`);
    scratchpad.facts.forEach(f => lines.push(`  • ${f}`));
    lines.push('');
  }

  if (scratchpad.signals.length > 0) {
    lines.push(`SIGNALS (${scratchpad.signals.length}):`);
    scratchpad.signals.forEach(s => lines.push(`  • ${s}`));
    lines.push('');
  }

  if (scratchpad.uncertainties.length > 0) {
    lines.push(`UNCERTAINTIES (${scratchpad.uncertainties.length}):`);
    scratchpad.uncertainties.forEach(u => lines.push(`  • ${u}`));
    lines.push('');
  }

  if (scratchpad.sources.length > 0) {
    lines.push(`SOURCES CONSULTED (${scratchpad.sources.length}):`);
    scratchpad.sources.forEach(s => {
      lines.push(`  • [${s.type}] ${s.query || s.url || 'N/A'}`);
    });
    lines.push('');
  }

  if (scratchpad.hypotheses.length > 0) {
    lines.push(`HYPOTHESES:`);
    scratchpad.hypotheses.forEach(h => {
      lines.push(`  ${h.position.toUpperCase()} (${h.confidence}% confidence): ${h.thesis}`);
      if (h.evidence.length > 0) {
        lines.push(`    Evidence: ${h.evidence.length} points`);
      }
      if (h.counterEvidence.length > 0) {
        lines.push(`    Counter-evidence: ${h.counterEvidence.length} points`);
      }
    });
    lines.push('');
  }

  if (scratchpad.notes.trim()) {
    const noteLines = scratchpad.notes.trim().split('\n');
    const recentNotes = noteLines.slice(-20).join('\n'); // Last 20 lines
    lines.push(`RECENT NOTES:`);
    lines.push(recentNotes);
    lines.push('');
  }

  if (scratchpad.synthesis) {
    lines.push(`SYNTHESIS (COMPLETE):`);
    lines.push(`  Position: ${scratchpad.synthesis.recommendedPosition.toUpperCase()}`);
    lines.push(`  Confidence: ${scratchpad.synthesis.confidence}`);
    lines.push(`  Thesis: ${scratchpad.synthesis.thesis}`);
  } else {
    lines.push(`SYNTHESIS: Not yet complete`);
  }

  return lines.join('\n');
}

/**
 * Export scratchpad as a structured object for the research agent
 */
export function exportForAgent(scratchpad: Scratchpad): object {
  return {
    marketId: scratchpad.marketId,
    marketQuestion: scratchpad.marketQuestion,
    factCount: scratchpad.facts.length,
    signalCount: scratchpad.signals.length,
    uncertaintyCount: scratchpad.uncertainties.length,
    sourcesConsulted: scratchpad.sources.length,
    hypotheses: scratchpad.hypotheses.map(h => ({
      position: h.position,
      confidence: h.confidence,
      evidenceCount: h.evidence.length,
      counterEvidenceCount: h.counterEvidence.length,
    })),
    hasSynthesis: !!scratchpad.synthesis,
    lastUpdated: scratchpad.updatedAt,
  };
}
