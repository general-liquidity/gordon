/**
 * Text Entity Extraction
 *
 * Thin wrapper over twitter/twitter-text — the official library Twitter uses
 * to validate tweets and extract entities. Gives Gordon proper cashtag,
 * hashtag, mention, and URL parsing for tweet bodies and any trade-adjacent
 * text (user paste, news headlines, Discord/Telegram chatter).
 *
 * Strictly matches X's own rules, so a cashtag that would be hyperlinked on
 * the X UI is the same cashtag Gordon sees here — no drift from ad-hoc regex.
 */

import twitterText from "twitter-text";

export interface TextEntities {
  /** Cashtags without the '$' prefix, uppercased: ["BTC", "ETH"]. */
  cashtags: string[];
  /** Hashtags without the '#' prefix, lowercased: ["defi", "degen"]. */
  hashtags: string[];
  /** Mentions without the '@' prefix: ["elonmusk", "cz_binance"]. */
  mentions: string[];
  /** Fully-formed URLs as they appear in the text. */
  urls: string[];
}

/** Extract cashtags. Returns uppercased symbols without the `$` prefix. */
export function extractCashtags(text: string): string[] {
  const raw = twitterText.extractCashtags(text) as string[];
  return dedupe(raw.map((c) => c.toUpperCase()));
}

/** Extract hashtags. Returns lowercased tags without the `#` prefix. */
export function extractHashtags(text: string): string[] {
  const raw = twitterText.extractHashtags(text) as string[];
  return dedupe(raw.map((h) => h.toLowerCase()));
}

/** Extract mentions. Returns handles without the `@` prefix. */
export function extractMentions(text: string): string[] {
  const raw = twitterText.extractMentions(text) as string[];
  return dedupe(raw);
}

/** Extract URLs as they appear in the text. */
export function extractUrls(text: string): string[] {
  const raw = twitterText.extractUrls(text) as string[];
  return dedupe(raw);
}

/**
 * Single-pass entity extraction. Cheaper than four separate calls because
 * twitter-text only has to parse the string once through its tokenizer.
 */
export function parseTextEntities(text: string): TextEntities {
  const withIndices = twitterText.extractEntitiesWithIndices(text) as Array<{
    cashtag?: string;
    hashtag?: string;
    screenName?: string;
    url?: string;
  }>;
  const cashtags: string[] = [];
  const hashtags: string[] = [];
  const mentions: string[] = [];
  const urls: string[] = [];
  for (const e of withIndices) {
    if (e.cashtag) cashtags.push(e.cashtag.toUpperCase());
    else if (e.hashtag) hashtags.push(e.hashtag.toLowerCase());
    else if (e.screenName) mentions.push(e.screenName);
    else if (e.url) urls.push(e.url);
  }
  return {
    cashtags: dedupe(cashtags),
    hashtags: dedupe(hashtags),
    mentions: dedupe(mentions),
    urls: dedupe(urls),
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
