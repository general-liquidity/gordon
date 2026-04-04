// ============================================================================
// Companion Generator — Deterministic companion from seed (user ID hash)
// ============================================================================

import { Species, Rarity, RARITY_WEIGHTS, type Companion, type Stats } from "./types.js";

// Mulberry32 seeded PRNG
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}

const SPECIES_LIST = Object.values(Species);
const RARITY_LIST = Object.values(Rarity);
const SYLLABLES = ["Zu", "Mi", "Ka", "Ra", "Lo", "Bi", "To", "Nu", "Fe", "Go", "Ax", "Pi", "Su", "Mo", "Da", "Ve"];

export function generateCompanion(seed: string): Companion {
  const rng = mulberry32(hashString(seed));

  // Species (uniform)
  const species = SPECIES_LIST[Math.floor(rng() * SPECIES_LIST.length)]!;

  // Rarity (weighted)
  const totalWeight = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * totalWeight;
  let rarity = Rarity.Common;
  for (const r of RARITY_LIST) {
    roll -= RARITY_WEIGHTS[r];
    if (roll <= 0) { rarity = r; break; }
  }

  // Stats: one peak (15-20), one dump (1-5), rest middle (8-14)
  const statKeys: (keyof Stats)[] = ["discipline", "patience", "timing", "conviction", "contrarian"];
  const peakIdx = Math.floor(rng() * 5);
  let dumpIdx = Math.floor(rng() * 5);
  if (dumpIdx === peakIdx) dumpIdx = (dumpIdx + 1) % 5;

  const stats = {} as Stats;
  for (let i = 0; i < 5; i++) {
    const key = statKeys[i]!;
    if (i === peakIdx) stats[key] = 15 + Math.floor(rng() * 6);
    else if (i === dumpIdx) stats[key] = 1 + Math.floor(rng() * 5);
    else stats[key] = 8 + Math.floor(rng() * 7);
  }

  // Name (2-3 syllables)
  const nameLen = 2 + Math.floor(rng() * 2);
  let name = "";
  for (let i = 0; i < nameLen; i++) {
    name += SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
  }
  name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

  return {
    species, name, rarity, stats, seed,
    hatIndex: Math.floor(rng() * 8),
    eyeIndex: Math.floor(rng() * 6),
    isShiny: rng() < 0.02,
  };
}
