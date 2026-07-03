/**
 * Self-History Recall — ranked, provenance-carrying search over Gordon's OWN
 * past chat sessions, built on the existing hybrid memory retrieval stack.
 */

export {
  refreshIndex,
  loadCatalog,
  saveCatalog,
  sessionToRecords,
  computeSha256,
  CATALOG_VERSION,
} from "./ingest.ts";
export type {
  SessionRecord,
  CatalogFileEntry,
  HistoryIndexCatalog,
  RefreshOptions,
  RefreshReport,
} from "./ingest.ts";

export { searchSessionHistory } from "./recall.ts";
export type { SessionRecallHit, SessionCitation, RecallOptions } from "./recall.ts";
