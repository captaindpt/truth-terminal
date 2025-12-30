/**
 * Test YouTube transcript fetching
 *
 * Usage:
 *   npx tsx src/test-youtube.ts <youtube-url-or-id>
 */

import { fetchTranscript, searchTranscript, getTranscriptPreview } from './agents/youtube.js';

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.log('Usage: npx tsx src/test-youtube.ts <youtube-url-or-id>');
    console.log('Example: npx tsx src/test-youtube.ts dQw4w9WgXcQ');
    return;
  }

  console.log(`\n📺 Fetching transcript for: ${input}\n`);

  try {
    const result = await fetchTranscript(input);

    console.log(`Video ID: ${result.videoId}`);
    console.log(`URL: ${result.url}`);
    console.log(`Segments: ${result.segments.length}`);
    console.log(`Total length: ${result.transcript.length} characters`);

    console.log('\n--- Preview (first 1000 chars) ---\n');
    console.log(getTranscriptPreview(result, 1000));

    // Demo keyword search
    const keywords = ['russia', 'ukraine', 'ceasefire', 'trump', 'war'];
    console.log(`\n--- Searching for keywords: ${keywords.join(', ')} ---\n`);

    const matches = searchTranscript(result, keywords, 15);
    if (matches.length === 0) {
      console.log('No keyword matches found.');
    } else {
      matches.slice(0, 5).forEach(match => {
        console.log(`[${match.timestamp}] "${match.keyword}":`);
        console.log(`  ${match.segments.map(s => s.text).join(' ').slice(0, 200)}...\n`);
      });
    }

    console.log('\n✅ Transcript fetch successful\n');
  } catch (error) {
    console.error('❌ Failed:', error);
  }
}

main();
