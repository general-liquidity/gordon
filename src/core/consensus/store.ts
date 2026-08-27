/**
 * Consensus Store
 *
 * SQLite persistence for consensus vote results.
 * Provides an audit trail and data for counterfactual learning.
 */

import { getDatabase } from "../../infra/storage/database.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { ConsensusResult } from "./protocol.ts";

const _logger = createModuleLogger("consensus-store");

let initialized = false;

function ensureTable(): void {
  if (initialized) return;

  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS consensus_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      playbook_name TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      score REAL NOT NULL,
      quorum_met INTEGER NOT NULL,
      votes_json TEXT NOT NULL,
      dissenting_agents TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_consensus_symbol ON consensus_votes(symbol)");
  db.run("CREATE INDEX IF NOT EXISTS idx_consensus_created_at ON consensus_votes(created_at)");

  initialized = true;
}

export function saveConsensusResult(result: ConsensusResult): void {
  ensureTable();

  const db = getDatabase();
  db.run(
    `INSERT INTO consensus_votes
     (symbol, playbook_name, slot_id, decision, score, quorum_met, votes_json, dissenting_agents, proposal_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      result.proposal.symbol,
      result.proposal.playbook_name,
      result.proposal.slot_id,
      result.decision,
      result.score,
      result.quorum_met ? 1 : 0,
      JSON.stringify(result.votes),
      result.dissenting_agents.join(","),
      JSON.stringify(result.proposal),
      result.timestamp,
    ],
  );
}

export interface ConsensusQuery {
  symbol?: string;
  playbookName?: string;
  decision?: "APPROVED" | "REJECTED";
  limit?: number;
}

interface ConsensusRow {
  decision: string;
  score: number;
  quorum_met: number;
  votes_json: string;
  dissenting_agents: string;
  proposal_json: string;
  created_at: string;
}

function mapRow(row: ConsensusRow): ConsensusResult {
  return {
    decision: row.decision as "APPROVED" | "REJECTED",
    score: row.score,
    quorum_met: row.quorum_met === 1,
    votes: JSON.parse(row.votes_json),
    dissenting_agents: row.dissenting_agents ? row.dissenting_agents.split(",") : [],
    proposal: JSON.parse(row.proposal_json),
    timestamp: row.created_at,
  };
}

export function queryConsensusResults(query: ConsensusQuery): ConsensusResult[] {
  ensureTable();

  const db = getDatabase();
  const limit = query.limit ?? 50;

  // Use separate query paths to keep type signatures concrete
  if (query.symbol && query.playbookName && query.decision) {
    return db
      .query<ConsensusRow, [string, string, string, number]>(
        `SELECT decision, score, quorum_met, votes_json, dissenting_agents, proposal_json, created_at
       FROM consensus_votes WHERE symbol = ? AND playbook_name = ? AND decision = ?
       ORDER BY created_at DESC LIMIT ?`,
      )
      .all(query.symbol, query.playbookName, query.decision, limit)
      .map(mapRow);
  }
  if (query.symbol) {
    return db
      .query<ConsensusRow, [string, number]>(
        `SELECT decision, score, quorum_met, votes_json, dissenting_agents, proposal_json, created_at
       FROM consensus_votes WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(query.symbol, limit)
      .map(mapRow);
  }
  if (query.playbookName) {
    return db
      .query<ConsensusRow, [string, number]>(
        `SELECT decision, score, quorum_met, votes_json, dissenting_agents, proposal_json, created_at
       FROM consensus_votes WHERE playbook_name = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(query.playbookName, limit)
      .map(mapRow);
  }

  return db
    .query<ConsensusRow, [number]>(
      `SELECT decision, score, quorum_met, votes_json, dissenting_agents, proposal_json, created_at
     FROM consensus_votes ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(mapRow);
}

export function getConsensusStats(playbookName: string): {
  total: number;
  approved: number;
  rejected: number;
  avgScore: number;
} {
  ensureTable();

  const db = getDatabase();
  const row = db
    .query<{ total: number; approved: number; avg_score: number }, [string]>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN decision = 'APPROVED' THEN 1 ELSE 0 END) as approved,
         AVG(score) as avg_score
       FROM consensus_votes
       WHERE playbook_name = ?`,
    )
    .get(playbookName);

  if (!row || row.total === 0) {
    return { total: 0, approved: 0, rejected: 0, avgScore: 0 };
  }

  return {
    total: row.total,
    approved: row.approved,
    rejected: row.total - row.approved,
    avgScore: row.avg_score,
  };
}
