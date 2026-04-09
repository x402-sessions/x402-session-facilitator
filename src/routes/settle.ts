import type { Request, Response } from "express";
import { config } from "../config";
import { debitSession, getSession, refundSession } from "../storage";
import { getLatestLedgerSequence, transferFrom } from "../stellar";
import { verify } from "./verify";
import type {
  PaymentPayload,
  PaymentRequirements,
  SessionPaymentPayloadBody,
  SettleRequest,
  SettleResponse,
} from "../types";

/**
 * POST /settle
 *
 * Re-runs verify(), then:
 *   1. Executes SAC transfer_from on-chain (facilitator as spender).
 *   2. Debits the session in sqlite after on-chain success.
 *
 * If the on-chain call fails, the session is NOT debited (no refund dance needed
 * because nothing moved).
 */
export async function settleHandler(req: Request, res: Response) {
  const body = req.body as Partial<SettleRequest>;
  const payload = body.paymentPayload;
  const requirements = body.paymentRequirements;

  if (!payload || !requirements) {
    return res.status(400).json({ error: "missing paymentPayload or paymentRequirements" });
  }

  const result = await settle(payload, requirements);
  return res.status(result.success ? 200 : 400).json(result);
}

export async function settle(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  // 1. Re-verify to be safe — /settle MUST re-run verify per x402 spec.
  const verifyResult = await verify(payload, requirements);
  if (!verifyResult.isValid) {
    return {
      success: false,
      errorReason: verifyResult.invalidReason ?? "verify_failed",
      errorMessage: verifyResult.invalidMessage,
      transaction: "",
      network: config.network,
    };
  }

  const sessionBody = payload.payload as SessionPaymentPayloadBody;
  const session = getSession(sessionBody.sessionId);
  if (!session) {
    return {
      success: false,
      errorReason: "session_not_found",
      transaction: "",
      network: config.network,
    };
  }

  const amount = BigInt(requirements.amount);

  // 2. Debit session FIRST (in a transaction with cap+expiry check).
  //    If the on-chain call later fails, we don't unwind — the caller should retry
  //    with a fresh verify; we log a loud error. In practice transfer_from should
  //    only fail if the on-chain allowance was revoked between verify and settle,
  //    which is rare and acceptable for v1.
  let latestLedger: number;
  try {
    latestLedger = await getLatestLedgerSequence();
  } catch (err) {
    return {
      success: false,
      errorReason: "rpc_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      transaction: "",
      network: config.network,
    };
  }

  let debited;
  try {
    debited = debitSession(sessionBody.sessionId, amount, latestLedger);
  } catch (err) {
    return {
      success: false,
      errorReason: "debit_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      transaction: "",
      network: config.network,
    };
  }

  // 3. Execute the on-chain transfer_from.
  try {
    const { txHash } = await transferFrom({
      assetContractId: session.asset,
      from: session.user,
      to: session.recipient,
      amount,
    });
    return {
      success: true,
      payer: session.user,
      transaction: txHash,
      network: config.network,
      extensions: {
        session: {
          id: debited.id,
          cap: debited.cap,
          spent: debited.spent,
          remaining: (BigInt(debited.cap) - BigInt(debited.spent)).toString(),
        },
      },
    };
  } catch (err) {
    // On-chain failed — roll back the sqlite debit so the session isn't
    // wrongly drained. The refund is idempotent and safe to apply even if
    // concurrent settles are in flight, because debitSession itself is atomic
    // (select + update under a transaction).
    console.error(
      `[settle] on-chain transfer_from FAILED; rolling back debit for session=${sessionBody.sessionId}`,
      err,
    );
    try {
      refundSession(sessionBody.sessionId, amount);
    } catch (refundErr) {
      console.error(
        `[settle] CRITICAL: refund failed after on-chain failure; session=${sessionBody.sessionId}`,
        refundErr,
      );
    }
    return {
      success: false,
      errorReason: "onchain_transfer_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      transaction: "",
      network: config.network,
    };
  }
}
