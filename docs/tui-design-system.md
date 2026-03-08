# TUI Design System

Gordon is a chat-first CLI. TUI changes should optimize operator speed and readability, not chase dashboard density.

## Visual Principles

- Prefer dense transcript-first layouts over decorative panels.
- Use semantic color by task or state, not one highlight color for everything.
- Use consistent loader geometry. Avoid mixing unrelated primitives with no semantic meaning.
- Keep motion light. The terminal should feel alive, not busy.

## Semantic Colors

| Role | Color family |
| --- | --- |
| Discover / market scan | sky / blue |
| Analyze / technical work | indigo |
| Trade / execution / portfolio | emerald |
| Run / systematic / experiments | violet |
| Rails / onchain / protocol flows | cyan |
| Operate / diagnostics / daemon | orange |
| Warning | amber |
| Error | red |
| Success | green |

## Loader Geometry

- Use one coherent angular/bar family for animated loader frames.
- The default Gordon loader uses bar-style market frames: `▁ ▃ ▅ ▇`.
- Reserve circles or dot badges for status indicators, not generic loading.

## Transcript Density

- Keep a bounded visible message window.
- Adapt the visible window to active streaming, task trees, and recent transcript size.
- When history is hidden, state exactly how many messages are hidden and how many remain visible.

## Startup

- Default startup after onboarding should be quieter than first-run onboarding.
- Prefer compact startup hints over long explanatory banners.
