// Session persistence via better-sqlite3.
//
// Sessions are uniquely identified by a uuid. The tuple (user, spender, asset)
// is effectively unique per active session, but we intentionally allow the same
// (user, spender, asset) to have multiple historical rows so we can audit.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SessionRecord, Network } from "./types";
import { config } from "./config";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  user              TEXT NOT NULL,
  spender           TEXT NOT NULL,
  asset             TEXT NOT NULL,
  recipient         TEXT NOT NULL,
  cap               TEXT NOT NULL,
  spent             TEXT NOT NULL DEFAULT '0',
  expiration_ledger INTEGER NOT NULL,
  approval_tx_hash  TEXT NOT NULL,
  network           TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user);
CREATE INDEX IF NOT EXISTS idx_sessions_spender_user ON sessions(spender, user);
`);

type Row = {
  id: string;
  user: string;
  spender: string;
  asset: string;
  recipient: string;
  cap: string;
  spent: string;
  expiration_ledger: number;
  approval_tx_hash: string;
  network: string;
  created_at: number;
};

function rowToRecord(r: Row): SessionRecord {
  return {
    id: r.id,
    user: r.user,
    spender: r.spender,
    asset: r.asset,
    recipient: r.recipient,
    cap: r.cap,
    spent: r.spent,
    expirationLedger: r.expiration_ledger,
    approvalTxHash: r.approval_tx_hash,
    network: r.network as Network,
    createdAt: r.created_at,
  };
}

const insertStmt = db.prepare(`
INSERT INTO sessions
  (id, user, spender, asset, recipient, cap, spent, expiration_ledger, approval_tx_hash, network, created_at)
VALUES
  (@id, @user, @spender, @asset, @recipient, @cap, '0', @expirationLedger, @approvalTxHash, @network, @createdAt)
`);

const getStmt = db.prepare<string>(`SELECT * FROM sessions WHERE id = ?`);

const debitStmt = db.prepare<{ id: string; spent: string }>(
  `UPDATE sessions SET spent = @spent WHERE id = @id`,
);

export function createSession(
  input: Omit<SessionRecord, "id" | "spent" | "createdAt">,
): SessionRecord {
  const record: SessionRecord = {
    id: randomUUID(),
    spent: "0",
    createdAt: Math.floor(Date.now() / 1000),
    ...input,
  };
  insertStmt.run(record);
  return record;
}

export function getSession(id: string): SessionRecord | null {
  const row = getStmt.get(id) as Row | undefined;
  return row ? rowToRecord(row) : null;
}

/**
 * Atomically attempts to debit `amount` from `sessionId`.
 * Returns the new spent value if successful; throws if insufficient or expired.
 *
 * Uses a transaction to guarantee atomicity under concurrent settle calls.
 */
export function debitSession(
  sessionId: string,
  amount: bigint,
  currentLedger: number,
): SessionRecord {
  const tx = db.transaction((): SessionRecord => {
    const row = getStmt.get(sessionId) as Row | undefined;
    if (!row) throw new Error(`session not found: ${sessionId}`);

    if (row.expiration_ledger <= currentLedger) {
      throw new Error(
        `session expired: expirationLedger=${row.expiration_ledger} currentLedger=${currentLedger}`,
      );
    }

    const cap = BigInt(row.cap);
    const spent = BigInt(row.spent);
    const next = spent + amount;
    if (next > cap) {
      throw new Error(
        `session cap exceeded: cap=${cap} spent=${spent} requested=${amount}`,
      );
    }

    debitStmt.run({ id: sessionId, spent: next.toString() });
    return rowToRecord({ ...row, spent: next.toString() });
  });
  return tx();
}

/**
 * Refund `amount` back to a session's remaining balance. Used when on-chain
 * settlement fails after we've already debited sqlite optimistically.
 * Clamps at 0 to prevent negative spent values under concurrent oddities.
 */
export function refundSession(sessionId: string, amount: bigint): SessionRecord {
  const tx = db.transaction((): SessionRecord => {
    const row = getStmt.get(sessionId) as Row | undefined;
    if (!row) throw new Error(`session not found: ${sessionId}`);
    const spent = BigInt(row.spent);
    const next = spent >= amount ? spent - amount : 0n;
    debitStmt.run({ id: sessionId, spent: next.toString() });
    return rowToRecord({ ...row, spent: next.toString() });
  });
  return tx();
}

export function closeDb() {
  db.close();
}
