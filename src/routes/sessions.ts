import type { Request, Response } from "express";
import { config, facilitatorAddress } from "../config";
import {
  assertTxSuccess,
  getLatestLedgerSequence,
  readAllowance,
} from "../stellar";
import { createSession, getSession } from "../storage";
import type { CreateSessionRequest, CreateSessionResponse } from "../types";

/**
 * POST /sessions
 *
 * Client calls this after it has signed & submitted the SAC `approve` tx on-chain.
 * The facilitator:
 *   1. Confirms the approval tx exists and succeeded on-chain.
 *   2. Reads the current allowance(user, facilitator) via SAC view.
 *   3. Verifies allowance >= cap the client claims.
 *   4. Persists the session record and returns a sessionId.
 */
export async function createSessionHandler(req: Request, res: Response) {
  const body = req.body as Partial<CreateSessionRequest>;

  const required: (keyof CreateSessionRequest)[] = [
    "approvalTxHash",
    "user",
    "asset",
    "recipient",
    "cap",
    "expirationLedger",
    "network",
  ];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return res.status(400).json({ error: `missing field: ${k}` });
    }
  }

  const input = body as CreateSessionRequest;

  if (input.network !== config.network) {
    return res.status(400).json({
      error: `network mismatch: facilitator=${config.network} request=${input.network}`,
    });
  }

  try {
    // 1. Confirm the approval tx exists and succeeded.
    await assertTxSuccess(input.approvalTxHash);

    // 2 + 3. Read on-chain allowance and verify it covers the claimed cap.
    const onChainAllowance = await readAllowance(
      input.asset,
      input.user,
      facilitatorAddress,
    );
    const claimedCap = BigInt(input.cap);
    if (onChainAllowance < claimedCap) {
      return res.status(400).json({
        error: `on-chain allowance ${onChainAllowance} is less than claimed cap ${claimedCap}`,
      });
    }

    // 4. Verify expiration ledger is still in the future.
    const latest = await getLatestLedgerSequence();
    if (input.expirationLedger <= latest) {
      return res.status(400).json({
        error: `expirationLedger ${input.expirationLedger} is in the past (current=${latest})`,
      });
    }

    const record = createSession({
      user: input.user,
      spender: facilitatorAddress,
      asset: input.asset,
      recipient: input.recipient,
      cap: claimedCap.toString(),
      expirationLedger: input.expirationLedger,
      approvalTxHash: input.approvalTxHash,
      network: input.network,
    });

    const response: CreateSessionResponse = {
      sessionId: record.id,
      user: record.user,
      spender: record.spender,
      asset: record.asset,
      recipient: record.recipient,
      cap: record.cap,
      spent: record.spent,
      expirationLedger: record.expirationLedger,
      network: record.network,
    };
    return res.status(201).json(response);
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * GET /sessions/:id
 * Returns the current session state (cap, spent, expiry).
 */
export function getSessionHandler(req: Request, res: Response) {
  const { id } = req.params;
  const record = getSession(id);
  if (!record) return res.status(404).json({ error: "session not found" });
  return res.json(record);
}
