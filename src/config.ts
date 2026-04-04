import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import type { Network } from "./types";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4021),
  network: (process.env.STELLAR_NETWORK ?? "stellar:testnet") as Network,
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase: process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  usdcContractId:
    process.env.USDC_CONTRACT_ID ?? "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  assetDecimals: Number(process.env.ASSET_DECIMALS ?? 7),
  maxPerCallDecimal: Number(process.env.MAX_PER_CALL ?? 1.0),
  dbPath: process.env.DB_PATH ?? "./sessions.db",
  facilitatorKeypair: Keypair.fromSecret(required("FACILITATOR_SECRET")),
};

export const facilitatorAddress = config.facilitatorKeypair.publicKey();

// Convert MAX_PER_CALL (decimal, e.g. 1.00) to base-unit bigint (stroops).
export const maxPerCallBaseUnits: bigint = BigInt(
  Math.round(config.maxPerCallDecimal * 10 ** config.assetDecimals),
);
