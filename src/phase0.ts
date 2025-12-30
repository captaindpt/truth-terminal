/**
 * PHASE 0: The Unit
 *
 * One market. One research task. One case output.
 * This is the atomic unit. Everything else is infrastructure to run this at scale.
 *
 * Usage:
 *   npx tsx src/phase0.ts                    # Analyze a random active market
 *   npx tsx src/phase0.ts <market-id>        # Analyze a specific market by ID
 *   npx tsx src/phase0.ts --list             # List top markets to choose from
 */

import 'dotenv/config';
import { fetchMarkets, fetchMarketById, marketSummary } from './polymarket/index.js';
import { analyzeMarket } from './agents/claude.js';
import { saveCase } from './db/index.js';
import type { PolymarketMarket, ResearchCase } from './types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function listMarkets(): Promise<void> {
  console.log('\n📊 Fetching active markets from Polymarket...\n');

  const markets = await fetchMarkets({
    active: true,
    closed: false,
    minVolume: 10000,      // At least $10k volume
    minLiquidity: 1000,    // At least $1k liquidity
    limit: 100
  });

  // Sort by volume
  markets.sort((a, b) => b.volume - a.volume);

  console.log(`Found ${markets.length} markets with decent volume/liquidity:\n`);

  markets.slice(0, 20).forEach((market, i) => {
    console.log(`${i + 1}. ${market.id}`);
    console.log(`   ${marketSummary(market)}\n`);
  });
}

async function analyzeOne(market: PolymarketMarket): Promise<ResearchCase> {
  console.log('\n🔍 Analyzing market...\n');
  console.log(`Question: ${market.question}`);
  console.log(`Description: ${market.description.slice(0, 200)}...`);
  console.log(`Current prices: ${market.outcomes.map((o, i) =>
    `${o}: ${(market.outcomePrices[i] * 100).toFixed(1)}%`
  ).join(' | ')}`);
  console.log(`Volume: $${market.volume.toLocaleString()}`);
  console.log(`End date: ${market.endDate}`);
  console.log('\n---\n');

  const researchCase = await analyzeMarket(market);

  return researchCase;
}

function printCase(researchCase: ResearchCase): void {
  console.log('📋 RESEARCH CASE\n');
  console.log(`Thesis: ${researchCase.thesis}\n`);
  console.log(`Recommended Position: ${researchCase.recommendedPosition}`);
  console.log(`Confidence: ${researchCase.confidence.toUpperCase()}\n`);

  console.log('Key Uncertainties:');
  researchCase.keyUncertainties.forEach(u => console.log(`  • ${u}`));

  console.log(`\nWhat Would Change Assessment:\n  ${researchCase.whatWouldChangeAssessment}\n`);

  console.log('Sources:');
  researchCase.sources.forEach(s => console.log(`  • ${s}`));

  console.log(`\nModel: ${researchCase.agentModel}`);
  console.log(`Generated: ${researchCase.createdAt}`);
}

function saveCaseToFile(researchCase: ResearchCase): string {
  const casesDir = path.join(__dirname, '../data/cases');
  if (!fs.existsSync(casesDir)) {
    fs.mkdirSync(casesDir, { recursive: true });
  }

  const filename = `${researchCase.marketId.slice(0, 8)}_${Date.now()}.json`;
  const filepath = path.join(casesDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(researchCase, null, 2));
  return filepath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // List mode
  if (args[0] === '--list' || args[0] === '-l') {
    await listMarkets();
    return;
  }

  let market: PolymarketMarket;

  // Specific market ID provided
  if (args[0]) {
    console.log(`\n📊 Fetching market ${args[0]}...`);
    market = await fetchMarketById(args[0]);
  } else {
    // Pick a random interesting market
    console.log('\n📊 Fetching a random active market...');
    const markets = await fetchMarkets({
      active: true,
      closed: false,
      minVolume: 50000,
      minLiquidity: 5000,
      limit: 50
    });

    if (markets.length === 0) {
      console.log('No markets found matching criteria');
      return;
    }

    market = markets[Math.floor(Math.random() * markets.length)];
  }

  // Run the analysis
  const researchCase = await analyzeOne(market);

  // Print results
  console.log('\n' + '='.repeat(60) + '\n');
  printCase(researchCase);

  // Save to file and database
  const filepath = saveCaseToFile(researchCase);
  const dbId = saveCase(researchCase);

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Case saved to: ${filepath}`);
  console.log(`   Database ID: ${dbId}`);
  console.log('\n💡 Review this case. Is it useful? Is it garbage? Where does it fail?');
  console.log('   This is Phase 0. Iterate on the prompt until the output is actionable.\n');
}

main().catch(console.error);
