import { describe, expect, it } from "bun:test";

import { browserLaunchCandidates } from "./oauth-flow.ts";

describe("OAuth browser launch", () => {
  const url = "https://venue.example/authorize?scope=read&state=(opaque)%25value";

  it("never routes the Windows OAuth URL through cmd.exe", () => {
    expect(browserLaunchCandidates(url, "win32")).toEqual([
      { command: "explorer.exe", args: [url] },
    ]);
  });

  it("keeps each Unix opener and URL in discrete argv elements", () => {
    expect(browserLaunchCandidates(url, "linux")).toEqual([
      { command: "xdg-open", args: [url] },
      { command: "gio", args: ["open", url] },
      { command: "kde-open5", args: [url] },
      { command: "kde-open", args: [url] },
      { command: "wslview", args: [url] },
    ]);
  });
});
