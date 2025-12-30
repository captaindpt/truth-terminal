/**
 * YouTube Transcript Fetcher
 *
 * Extracts transcripts/subtitles from YouTube videos for analysis.
 * No API key needed - works with auto-generated subtitles.
 *
 * Use cases:
 * - Analyze interviews with key figures
 * - Extract info from news segments
 * - Get quotes from podcasts discussing markets
 */

import { YoutubeTranscript } from 'youtube-transcript';

export interface TranscriptSegment {
  text: string;
  offset: number;  // milliseconds
  duration: number;
}

export interface VideoTranscript {
  videoId: string;
  url: string;
  transcript: string;
  segments: TranscriptSegment[];
  language?: string;
}

/**
 * Extract video ID from various YouTube URL formats
 */
function extractVideoId(urlOrId: string): string {
  // Already an ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  // Try to extract from URL
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from: ${urlOrId}`);
}

/**
 * Fetch transcript from a YouTube video
 */
export async function fetchTranscript(urlOrId: string): Promise<VideoTranscript> {
  const videoId = extractVideoId(urlOrId);

  try {
    const rawTranscript = await YoutubeTranscript.fetchTranscript(videoId);

    const segments: TranscriptSegment[] = rawTranscript.map(item => ({
      text: item.text,
      offset: item.offset,
      duration: item.duration
    }));

    // Combine into full transcript text
    const transcript = segments.map(s => s.text).join(' ');

    return {
      videoId,
      url: `https://youtube.com/watch?v=${videoId}`,
      transcript,
      segments
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch transcript for ${videoId}: ${error.message}`);
  }
}

/**
 * Fetch transcripts from multiple videos
 */
export async function fetchMultipleTranscripts(
  urlsOrIds: string[]
): Promise<{ success: VideoTranscript[]; failed: { id: string; error: string }[] }> {
  const results = await Promise.allSettled(
    urlsOrIds.map(id => fetchTranscript(id))
  );

  const success: VideoTranscript[] = [];
  const failed: { id: string; error: string }[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      success.push(result.value);
    } else {
      failed.push({
        id: urlsOrIds[i],
        error: result.reason?.message || 'Unknown error'
      });
    }
  });

  return { success, failed };
}

/**
 * Search transcript for keywords and return relevant segments
 */
export function searchTranscript(
  transcript: VideoTranscript,
  keywords: string[],
  contextSeconds: number = 30
): { keyword: string; segments: TranscriptSegment[]; timestamp: string }[] {
  const results: { keyword: string; segments: TranscriptSegment[]; timestamp: string }[] = [];

  for (const keyword of keywords) {
    const regex = new RegExp(keyword, 'gi');

    for (let i = 0; i < transcript.segments.length; i++) {
      const segment = transcript.segments[i];
      if (regex.test(segment.text)) {
        // Get surrounding context
        const contextMs = contextSeconds * 1000;
        const startTime = Math.max(0, segment.offset - contextMs);
        const endTime = segment.offset + segment.duration + contextMs;

        const contextSegments = transcript.segments.filter(
          s => s.offset >= startTime && s.offset <= endTime
        );

        // Format timestamp
        const seconds = Math.floor(segment.offset / 1000);
        const minutes = Math.floor(seconds / 60);
        const hrs = Math.floor(minutes / 60);
        const timestamp = hrs > 0
          ? `${hrs}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
          : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;

        results.push({
          keyword,
          segments: contextSegments,
          timestamp
        });
      }
    }
  }

  return results;
}

/**
 * Get a summary-ready version of the transcript (first N characters)
 */
export function getTranscriptPreview(transcript: VideoTranscript, maxLength: number = 5000): string {
  if (transcript.transcript.length <= maxLength) {
    return transcript.transcript;
  }
  return transcript.transcript.slice(0, maxLength) + '... [truncated]';
}
