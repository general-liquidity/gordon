import {
  KeyContext,
  type KeyBinding,
  type KeybindingAction,
  type ParsedKeystroke,
} from "./types.js";
import { keystrokesEqual } from "./parser.js";

// ============================================================================
// Keybinding Resolver — Priority-based resolution with chord and context support
//
// Resolution order: user overrides > defaults
// Context fallthrough: specific context > Global
// Chord state machine: tracks partial chord progress with 1500ms timeout
// ============================================================================

export class KeybindingResolver {
  private bindings: KeyBinding[];
  private chordBuffer: ParsedKeystroke[] = [];
  private chordTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(defaults: KeyBinding[], userOverrides: KeyBinding[] = []) {
    // User overrides take priority — prepend them so they match first
    this.bindings = [...userOverrides, ...defaults];
  }

  resolve(keystroke: ParsedKeystroke, context: KeyContext): KeybindingAction | null {
    // Add keystroke to chord buffer
    this.chordBuffer.push(keystroke);

    // Reset chord timeout
    if (this.chordTimeout) clearTimeout(this.chordTimeout);
    this.chordTimeout = setTimeout(() => {
      this.chordBuffer = [];
    }, 1500);

    // Try to match the full chord buffer
    const match = this.findMatch(this.chordBuffer, context);

    if (match === "partial") {
      // Partial chord match — waiting for more keystrokes
      return null;
    }

    if (match) {
      this.chordBuffer = [];
      if (this.chordTimeout) clearTimeout(this.chordTimeout);
      return match;
    }

    // No match with full buffer — try just the latest keystroke
    if (this.chordBuffer.length > 1) {
      this.chordBuffer = [keystroke];
      const singleMatch = this.findMatch(this.chordBuffer, context);
      if (singleMatch && singleMatch !== "partial") {
        this.chordBuffer = [];
        if (this.chordTimeout) clearTimeout(this.chordTimeout);
        return singleMatch;
      }
    }

    // No match at all
    this.chordBuffer = [];
    if (this.chordTimeout) clearTimeout(this.chordTimeout);
    return null;
  }

  private findMatch(
    buffer: ParsedKeystroke[],
    context: KeyContext,
  ): KeybindingAction | "partial" | null {
    let partialMatch = false;

    for (const binding of this.bindings) {
      // Context must match or be Global (fallthrough)
      if (binding.context !== context && binding.context !== KeyContext.Global) {
        continue;
      }

      const chord = binding.chord;

      // Check if buffer is a prefix of the chord
      if (buffer.length < chord.length) {
        const isPrefix = buffer.every((ks, i) => keystrokesEqual(ks, chord[i]!));
        if (isPrefix) {
          partialMatch = true;
        }
        continue;
      }

      // Check exact match
      if (buffer.length === chord.length) {
        const isMatch = buffer.every((ks, i) => keystrokesEqual(ks, chord[i]!));
        if (isMatch) {
          return binding.action;
        }
      }
    }

    return partialMatch ? "partial" : null;
  }

  getBindingForAction(action: KeybindingAction, context?: KeyContext): KeyBinding | null {
    return (
      this.bindings.find(
        (b) =>
          b.action === action &&
          (!context || b.context === context || b.context === KeyContext.Global),
      ) ?? null
    );
  }
}
