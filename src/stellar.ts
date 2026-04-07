// Soroban / SAC interaction helpers for the facilitator.
//
// All functions use the `rpc.Server` namespace from @stellar/stellar-sdk v14+/v15.
// Reference: https://stellar.github.io/js-stellar-sdk/

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { config, facilitatorAddress } from "./config";

const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: false });

// ---------- helpers ----------

function toI128(amount: bigint | string): xdr.ScVal {
  return nativeToScVal(typeof amount === "string" ? BigInt(amount) : amount, { type: "i128" });
}

function addrToScVal(addr: string): xdr.ScVal {
  return Address.fromString(addr).toScVal();
}

async function waitForTx(
  hash: string,
  timeoutMs = 30_000,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return res as rpc.Api.GetSuccessfulTransactionResponse;
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`tx failed: ${hash} ${JSON.stringify(res)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`tx ${hash} timed out waiting for confirmation`);
}

// ---------- read-only ----------

/**
 * Read on-chain allowance of `spender` over `from` via the SAC `allowance` view.
 * Returns 0 if no allowance exists.
 */
export async function readAllowance(
  assetContractId: string,
  from: string,
  spender: string,
): Promise<bigint> {
  // Simulation source just needs to exist; no state mutation will occur.
  const account = await server.getAccount(facilitatorAddress);
  const contract = new Contract(assetContractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call("allowance", addrToScVal(from), addrToScVal(spender)))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`allowance sim failed: ${JSON.stringify(sim)}`);
  }
  const val = scValToNative(sim.result.retval);
  return typeof val === "bigint" ? val : BigInt(val);
}

/**
 * Fetch a completed transaction and confirm it exists and succeeded.
 * Used to validate the approval tx hash the client provides when creating a session.
 */
export async function assertTxSuccess(txHash: string): Promise<void> {
  const res = await server.getTransaction(txHash);
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`approval tx ${txHash} not successful (status=${res.status})`);
  }
}

export async function getLatestLedgerSequence(): Promise<number> {
  const latest = await server.getLatestLedger();
  return latest.sequence;
}

// ---------- write: transfer_from ----------

/**
 * Execute SAC `transfer_from(spender=facilitator, from=user, to=recipient, amount)`.
 *
 * The facilitator's keypair is the tx source, so its `require_auth(&spender)` is
 * automatically satisfied — no manual authorizeEntry needed. The `from` account's
 * prior on-chain `approve(from, facilitator, cap, expiration_ledger)` is what
 * authorizes pulling the funds.
 */
export async function transferFrom(args: {
  assetContractId: string;
  from: string;
  to: string;
  amount: bigint;
}): Promise<{ txHash: string }> {
  const kp: Keypair = config.facilitatorKeypair;
  const source = await server.getAccount(kp.publicKey());
  const contract = new Contract(args.assetContractId);

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "transfer_from",
        addrToScVal(kp.publicKey()), // spender (caller)
        addrToScVal(args.from),
        addrToScVal(args.to),
        toI128(args.amount),
      ),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`sendTransaction ERROR: ${JSON.stringify(sent.errorResult)}`);
  }

  await waitForTx(sent.hash);
  return { txHash: sent.hash };
}

// ---------- utility: testnet network helpers ----------

export function networkPassphraseFor(network: string): string {
  if (network.startsWith("stellar:pubnet")) return Networks.PUBLIC;
  return Networks.TESTNET;
}
