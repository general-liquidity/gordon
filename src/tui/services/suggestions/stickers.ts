// ============================================================================
// Stickers — Tag trades with emoji badges for journal review
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

export interface Sticker { id: string; emoji: string; label: string; }

const STICKERS_PATH = join(getGordonDir(), "stickers.json");

const AVAILABLE: Sticker[] = [
  { id: "revenge-trade", emoji: "\uD83D\uDCA2", label: "Revenge Trade" },
  { id: "textbook-setup", emoji: "\uD83D\uDCD6", label: "Textbook Setup" },
  { id: "big-win", emoji: "\uD83C\uDFC6", label: "Big Win" },
  { id: "lesson-learned", emoji: "\uD83D\uDCA1", label: "Lesson Learned" },
  { id: "fomo", emoji: "\uD83D\uDE30", label: "FOMO" },
  { id: "diamond-hands", emoji: "\uD83D\uDC8E", label: "Diamond Hands" },
  { id: "paper-hands", emoji: "\uD83E\uDDF4", label: "Paper Hands" },
  { id: "moon-shot", emoji: "\uD83C\uDF19", label: "Moon Shot" },
  { id: "rug-pull", emoji: "\uD83E\uDDF9", label: "Rug Pull" },
  { id: "dip-buy", emoji: "\uD83D\uDED2", label: "Dip Buy" },
];

export class StickerService {
  private tags: Record<string, string[]> = {};

  constructor() {
    try {
      if (existsSync(STICKERS_PATH)) this.tags = JSON.parse(readFileSync(STICKERS_PATH, "utf-8"));
    } catch { this.tags = {}; }
  }

  listStickers(): Sticker[] { return AVAILABLE; }

  tagTrade(tradeId: string, stickerId: string): void {
    if (!this.tags[tradeId]) this.tags[tradeId] = [];
    if (!this.tags[tradeId]!.includes(stickerId)) {
      this.tags[tradeId]!.push(stickerId);
      this.save();
    }
  }

  getTradeStickers(tradeId: string): Sticker[] {
    const ids = this.tags[tradeId] ?? [];
    return AVAILABLE.filter((s) => ids.includes(s.id));
  }

  private save(): void {
    try { writeFileSync(STICKERS_PATH, JSON.stringify(this.tags, null, 2)); } catch {}
  }
}
