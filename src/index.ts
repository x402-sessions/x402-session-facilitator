import express from "express";
import { config, facilitatorAddress } from "./config";
import { supportedHandler } from "./routes/supported";
import { createSessionHandler, getSessionHandler } from "./routes/sessions";
import { verifyHandler } from "./routes/verify";
import { settleHandler } from "./routes/settle";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS — open for dev. Lock down in production.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, address: facilitatorAddress }));

// Standard x402 facilitator endpoints
app.get("/supported", supportedHandler);
app.post("/verify", verifyHandler);
app.post("/settle", settleHandler);

// Session-scheme extension endpoints
app.post("/sessions", createSessionHandler);
app.get("/sessions/:id", getSessionHandler);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[facilitator] unhandled error:", err);
  res.status(500).json({ error: err.message });
});

app.listen(config.port, () => {
  console.log(
    `[x402-sessions facilitator] listening on :${config.port}\n` +
      `  network:     ${config.network}\n` +
      `  rpc:         ${config.sorobanRpcUrl}\n` +
      `  address:     ${facilitatorAddress}\n` +
      `  usdc:        ${config.usdcContractId}\n` +
      `  max/call:    ${config.maxPerCallDecimal}\n` +
      `  db:          ${config.dbPath}`,
  );
});
