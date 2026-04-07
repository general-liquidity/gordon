export {
  loadGordonMd,
  initializeUserGordonMd,
  writeGordonMd,
  buildAgentPromptBlock,
  USER_GORDON_MD,
  DEFAULT_GORDON_MD,
} from "./gordonMd.ts";
export type { GordonMdFile, LoadedGordonMd } from "./gordonMd.ts";

// 7-level settings priority chain
export {
  loadLayeredSettings,
  getSettingProvenance,
  setSessionOverride,
  clearSessionOverrides,
  setCliOverrides,
} from "./settingsLayers.ts";
export type {
  SettingsLayer,
  LayeredSettings,
  MergedSettings,
  LoadSettingsOptions,
} from "./settingsLayers.ts";
