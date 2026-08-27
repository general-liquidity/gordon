import packageJson from "../package.json" with { type: "json" };

/** One source for source, bundled, and Bun-compiled version reporting. */
export const GORDON_VERSION = packageJson.version;
