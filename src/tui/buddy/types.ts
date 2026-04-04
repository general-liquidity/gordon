// ============================================================================
// Buddy Types — Trading companion mascot system
// ============================================================================

export enum Species {
  Duck = "Duck", Goose = "Goose", Cat = "Cat", Dog = "Dog", Owl = "Owl",
  Penguin = "Penguin", Dragon = "Dragon", Octopus = "Octopus", Robot = "Robot",
  Ghost = "Ghost", Cactus = "Cactus", Mushroom = "Mushroom", Snail = "Snail",
  Turtle = "Turtle", Axolotl = "Axolotl", Capybara = "Capybara", Rabbit = "Rabbit",
  Bull = "Bull",
}

export enum Rarity { Common = "Common", Uncommon = "Uncommon", Rare = "Rare", Epic = "Epic", Legendary = "Legendary" }

export enum Mood { Ecstatic = "Ecstatic", Happy = "Happy", Neutral = "Neutral", Nervous = "Nervous", Panicking = "Panicking" }

export interface Stats { discipline: number; patience: number; timing: number; conviction: number; contrarian: number; }

export interface Companion {
  species: Species; name: string; rarity: Rarity; stats: Stats;
  hatIndex: number; eyeIndex: number; isShiny: boolean; seed: string;
}

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  [Rarity.Common]: 50, [Rarity.Uncommon]: 25, [Rarity.Rare]: 15, [Rarity.Epic]: 8, [Rarity.Legendary]: 2,
};

export const RARITY_COLORS: Record<Rarity, string> = {
  [Rarity.Common]: "white", [Rarity.Uncommon]: "green", [Rarity.Rare]: "blue",
  [Rarity.Epic]: "magenta", [Rarity.Legendary]: "yellowBright",
};

export const MOOD_COLORS: Record<Mood, string> = {
  [Mood.Ecstatic]: "greenBright", [Mood.Happy]: "green", [Mood.Neutral]: "white",
  [Mood.Nervous]: "yellow", [Mood.Panicking]: "red",
};
