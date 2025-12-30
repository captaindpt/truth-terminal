/**
 * Test Grok/xAI integration
 *
 * Usage:
 *   npx tsx src/test-grok.ts                         # Test with default topic
 *   npx tsx src/test-grok.ts "Russia Ukraine ceasefire"  # Test with custom topic
 */

import 'dotenv/config';
import { researchTopic, twitterSentiment } from './agents/grok.js';

async function main() {
  const topic = process.argv[2] || 'Russia Ukraine ceasefire 2025';

  console.log('\n🔍 Testing Grok/xAI Integration\n');
  console.log(`Topic: ${topic}\n`);
  console.log('='.repeat(60) + '\n');

  // Test 1: Full research (web + twitter + news)
  console.log('📊 Full Research (Web + Twitter + News):\n');
  try {
    const research = await researchTopic(topic, {
      dateRange: {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        to: new Date()
      }
    });

    console.log(research.content);
    console.log('\n--- Citations ---');
    research.citations.forEach((c, i) => console.log(`${i + 1}. ${c}`));
    console.log(`\nSources used: ${research.sourcesUsed}`);
    console.log(`Model: ${research.model}`);
  } catch (error) {
    console.error('Research failed:', error);
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 2: Twitter-only sentiment
  console.log('🐦 Twitter Sentiment Check:\n');
  try {
    const sentiment = await twitterSentiment(topic, 7);

    console.log(sentiment.content);
    console.log('\n--- Citations ---');
    sentiment.citations.forEach((c, i) => console.log(`${i + 1}. ${c}`));
    console.log(`\nSources used: ${sentiment.sourcesUsed}`);
  } catch (error) {
    console.error('Sentiment check failed:', error);
  }

  console.log('\n✅ Test complete\n');
}

main().catch(console.error);
