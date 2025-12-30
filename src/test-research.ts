/**
 * Test the full multi-source research pipeline
 *
 * Usage:
 *   npx tsx src/test-research.ts                    # Random market
 *   npx tsx src/test-research.ts 516719             # Specific market ID
 *   npx tsx src/test-research.ts --quick 516719     # Quick research (faster)
 */

import 'dotenv/config';
import { fetchMarkets, fetchMarketById } from './polymarket/index.js';
import { quickResearch, deepResearch } from './agents/research.js';
import { saveCase } from './db/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const quickMode = args.includes('--quick');
  const marketId = args.find(a => !a.startsWith('--'));

  console.log('\n🔬 Multi-Source Research Pipeline Test\n');
  console.log(`Mode: ${quickMode ? 'Quick' : 'Deep'}`);

  // Get market
  let market;
  if (marketId) {
    console.log(`\nFetching market ${marketId}...`);
    market = await fetchMarketById(marketId);
  } else {
    console.log('\nFetching a random high-volume market...');
    const markets = await fetchMarkets({
      active: true,
      closed: false,
      minVolume: 100000,
      minLiquidity: 10000,
      limit: 20
    });
    market = markets[Math.floor(Math.random() * markets.length)];
  }

  console.log(`\n📊 Market: ${market.question}`);
  console.log(`   Prices: ${market.outcomes.map((o, i) => `${o}: ${(market.outcomePrices[i] * 100).toFixed(0)}%`).join(' | ')}`);
  console.log(`   Volume: $${market.volume.toLocaleString()}`);
  console.log(`   End: ${market.endDate}\n`);

  console.log('='.repeat(60) + '\n');

  // Run research
  const startTime = Date.now();

  const researchCase = quickMode
    ? await quickResearch(market)
    : await deepResearch(market);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 RESEARCH CASE\n');

  console.log(`Thesis:\n  ${researchCase.thesis}\n`);
  console.log(`Recommended Position: ${researchCase.recommendedPosition}`);
  console.log(`Confidence: ${researchCase.confidence.toUpperCase()}\n`);

  console.log('Key Uncertainties:');
  researchCase.keyUncertainties.forEach(u => console.log(`  • ${u}`));

  console.log(`\nWhat Would Change Assessment:\n  ${researchCase.whatWouldChangeAssessment}\n`);

  console.log(`Sources (${researchCase.sources.length}):`);
  researchCase.sources.slice(0, 10).forEach(s => console.log(`  • ${s}`));
  if (researchCase.sources.length > 10) {
    console.log(`  ... and ${researchCase.sources.length - 10} more`);
  }

  // Save
  const casesDir = path.join(__dirname, '../data/cases');
  if (!fs.existsSync(casesDir)) {
    fs.mkdirSync(casesDir, { recursive: true });
  }
  const filename = `${market.id.slice(0, 8)}_${Date.now()}.json`;
  const filepath = path.join(casesDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(researchCase, null, 2));

  const dbId = saveCase(researchCase);

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Research complete in ${elapsed}s`);
  console.log(`   Saved to: ${filepath}`);
  console.log(`   Database ID: ${dbId}\n`);
}

main().catch(console.error);
