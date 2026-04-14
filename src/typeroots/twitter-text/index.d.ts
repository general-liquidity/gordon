declare module "twitter-text" {
  export interface TweetEntity {
    cashtag?: string;
    hashtag?: string;
    screenName?: string;
    url?: string;
    indices: [number, number];
  }
  export function extractCashtags(text: string): string[];
  export function extractHashtags(text: string): string[];
  export function extractMentions(text: string): string[];
  export function extractUrls(text: string): string[];
  export function extractEntitiesWithIndices(text: string): TweetEntity[];
  const twitterText: {
    extractCashtags: typeof extractCashtags;
    extractHashtags: typeof extractHashtags;
    extractMentions: typeof extractMentions;
    extractUrls: typeof extractUrls;
    extractEntitiesWithIndices: typeof extractEntitiesWithIndices;
  };
  export default twitterText;
}
