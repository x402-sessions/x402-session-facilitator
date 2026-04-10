# x402-sessions facilitator

Reference HTTP facilitator for the `session` scheme on Stellar. Companion to the [`x402-sessions`](../x402-sessions) SDK.

Implements the x402 facilitator API (`GET /supported`, `POST /verify`, `POST /settle`) plus a session-management extension (`POST /sessions`, `GET /sessions/:id`) and performs on-chain SAC `transfer_from` calls on Soroban.

## How it works

1. Client (via `x402-sessions` SDK) signs & submits `approve(user, facilitator, cap, expiration_ledger)` on-chain.
2. Client `POST`s the tx hash to `/sessions`. Facilitator verifies the on-chain allowance via SAC `allowance()` view, stores a session record in sqlite, returns a `sessionId`.
3. Client attaches `sessionId` to subsequent `X-PAYMENT` headers on protected requests.
4. Resource server's x402 middleware calls `/verify` and `/settle`. Facilitator checks the session (cap, expiry, recipient, per-call limit), debits sqlite, executes SAC `transfer_from(facilitator, user, recipient, amount)`.

On-chain hard guarantees: **total cap** + **expiry**.  
Off-chain facilitator policy: **per-call price limit** + **recipient binding** + **session bookkeeping**.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — set FACILITATOR_SECRET to a Stellar keypair funded with testnet XLM
npm run dev
```

### Fund the facilitator address on testnet

```bash
# Get the public key from .env (derived from FACILITATOR_SECRET), then:
curl "https://friendbot.stellar.org?addr=<YOUR_FACILITATOR_PUBLIC_KEY>"
```

### Generate a fresh keypair

```bash
node -e "const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();console.log('PUBLIC=',k.publicKey());console.log('SECRET=',k.secret());"
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness check |
| GET  | `/supported` | x402 spec: list supported `(scheme, network)` kinds and signer addresses |
| POST | `/verify` | x402 spec: stateless check that a session payload is valid |
| POST | `/settle` | x402 spec: re-verify + debit session + execute on-chain `transfer_from` |
| POST | `/sessions` | Create a session from a signed approval tx hash |
| GET  | `/sessions/:id` | Inspect session state (cap, spent, expiry) |

## POST /sessions request shape

```json
{
  "approvalTxHash": "abc123...",
  "user": "G...payer",
  "asset": "CBIELTK6...",
  "recipient": "G...resource_server",
  "cap": "10000000",
  "expirationLedger": 123456,
  "network": "stellar:testnet"
}
```

## Env vars

```
PORT=4021
STELLAR_NETWORK=stellar:testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
FACILITATOR_SECRET=S...         # funded testnet keypair
USDC_CONTRACT_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
ASSET_DECIMALS=7
MAX_PER_CALL=1.00               # decimal; /settle refuses calls above this
DB_PATH=./sessions.db
```

## Storage

`better-sqlite3`, WAL mode. One table: `sessions`. Atomic debit under a sqlite transaction so concurrent `/settle` calls can't double-spend the session.

## Known limitations (v1)

- **On-chain rollback gap**: if sqlite debit succeeds but the on-chain `transfer_from` fails (e.g. user revoked the approval between verify and settle), the session balance is still decremented and the client gets an error. Rare; acceptable for v1. v2 should add a compensating rollback.
- **Per-call policy is trust-based**: the facilitator promises not to overspend per call, but on-chain the SAC only enforces the total cap. For true on-chain per-call enforcement, upgrade the client to a Soroban smart wallet with a policy-signer session key (out of scope for this package).
- **Testnet only in defaults**: pubnet works by changing env vars, but hasn't been exercised.
- **Single facilitator address**: no key rotation or load balancing. Use a process manager for HA.
