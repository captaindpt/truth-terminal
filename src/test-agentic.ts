/**
 * Test the new agentic research pipeline
 */

import 'dotenv/config';
import { agenticResearch } from './agents/agentic-research.js';
import { fetchMarketById } from './polymarket/client.js';
import { saveCase } from './db/index.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

async function main() {
  const marketId = process.argv[2];

  if (!marketId) {
    console.log('Usage: npx tsx src/test-agentic.ts <market-id>');
    console.log('');
    console.log('Get market IDs from: npm run phase0:list');
    process.exit(1);
  }

  console.log('🔬 Agentic Research Pipeline Test\n');

  // Fetch market
  console.log(`Fetching market ${marketId}...`);
  const market = await fetchMarketById(marketId);

  if (!market) {
    console.error(`Market ${marketId} not found`);
    process.exit(1);
  }

  console.log(`\n📊 Market: ${market.question}`);
  console.log(`   Prices: Yes: ${(market.outcomePrices[0] * 100).toFixed(0)}% | No: ${(market.outcomePrices[1] * 100).toFixed(0)}%`);
  console.log(`   Volume: $${market.volume.toLocaleString()}`);
  console.log(`   End: ${market.endDate}`);
  console.log('\n' + '='.repeat(60) + '\n');

  const startTime = Date.now();

  // Run agentic research
  const researchCase = await agenticResearch(market, {
    maxToolCalls: 15,
    verbose: true
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('\n📋 RESEARCH CASE\n');
  console.log(`Thesis:\n  ${researchCase.thesis.split('\n').join('\n  ')}`);
  console.log(`\nRecommended Position: ${researchCase.recommendedPosition}`);
  console.log(`Confidence: ${researchCase.confidence.toUpperCase()}`);
  console.log(`\nKey Uncertainties:`);
  const uncertainties = Array.isArray(researchCase.keyUncertainties)
    ? researchCase.keyUncertainties
    : [researchCase.keyUncertainties];
  uncertainties.forEach(u => console.log(`  • ${u}`));
  console.log(`\nWhat Would Change Assessment:\n  ${researchCase.whatWouldChangeAssessment}`);
  console.log(`\nSources (${researchCase.sources.length}):`);
  researchCase.sources.slice(0, 10).forEach(s => console.log(`  • ${s}`));

  // Save to database
  const dbId = await saveCase(researchCase);

  // Save to file
  if (!existsSync('data/cases')) {
    mkdirSync('data/cases', { recursive: true });
  }
  const filename = `data/cases/${marketId}_agentic_${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(researchCase, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Research complete in ${elapsed}s`);
  console.log(`   Saved to: ${filename}`);
  console.log(`   Database ID: ${dbId}`);
}

main().catch(console.error);
