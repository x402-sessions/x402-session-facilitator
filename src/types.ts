// Wire-format types for the x402-sessions facilitator.
//
// Scheme: "session"  (new scheme we register alongside x402's "exact" scheme)
// Network: "stellar:testnet" | "stellar:pubnet"
//
// --------------------------------------------------------------------------
// The x402 HTTP facilitator API (from @x402/core HTTPFacilitatorClient) is:
//   GET  /supported            -> SupportedResponse
//   POST /verify               -> VerifyResponse
//   POST /settle               -> SettleResponse
//
// We add one extra endpoint for session management:
//   POST /sessions             -> create a session from a signed approval tx hash
//   GET  /sessions/:id         -> inspect session state
// --------------------------------------------------------------------------

export type Network = `${string}:${string}`;

export type PaymentRequirements = {
  scheme: string;
  network: Network;
  asset: string;
  amount: string; // per-call price in base units (stroops for 7-decimal USDC)
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

// The scheme-specific slot for the `session` scheme.
export type SessionPaymentPayloadBody = {
  sessionId: string;
};

export type PaymentPayload = {
  x402Version: number;
  resource?: { url: string; description?: string; mimeType?: string };
  accepted: PaymentRequirements;
  payload: SessionPaymentPayloadBody | Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type VerifyRequest = {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
};

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
};

export type SettleRequest = VerifyRequest;

export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: Network;
  extensions?: Record<string, unknown>;
};

export type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: Network;
  extra?: Record<string, unknown>;
};

export type SupportedResponse = {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
};

// --------------------------------------------------------------------------
// Session records (persisted in sqlite)
// --------------------------------------------------------------------------

export type SessionRecord = {
  id: string;               // uuid
  user: string;             // G... payer address
  spender: string;          // G... facilitator address (caller of transfer_from)
  asset: string;            // C... SAC contract id
  recipient: string;        // G... resource server (pay-to); bound at creation
  cap: string;              // total approved amount (base units, string for bigint safety)
  spent: string;            // cumulative spent so far
  expirationLedger: number; // on-chain approval expiry
  approvalTxHash: string;   // the approve tx that granted allowance
  network: Network;
  createdAt: number;        // unix seconds
};

// --------------------------------------------------------------------------
// POST /sessions request/response
// --------------------------------------------------------------------------

export type CreateSessionRequest = {
  approvalTxHash: string;
  user: string;
  asset: string;
  recipient: string;
  cap: string;              // base units
  expirationLedger: number;
  network: Network;
};

export type CreateSessionResponse = {
  sessionId: string;
  user: string;
  spender: string;
  asset: string;
  recipient: string;
  cap: string;
  spent: string;
  expirationLedger: number;
  network: Network;
};
