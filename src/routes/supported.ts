import type { Request, Response } from "express";
import { config, facilitatorAddress } from "../config";
import type { SupportedResponse } from "../types";

export function supportedHandler(_req: Request, res: Response) {
  // Advertise both x402 v1 and v2 so either client codepath finds us.
  const extra = {
    areFeesSponsored: true,
    facilitatorAddress,
    // Clients use this to know which on-chain address to name as `spender`
    // in their SAC `approve` tx.
    spender: facilitatorAddress,
    sessionsEndpoint: "/sessions",
  };
  const body: SupportedResponse = {
    kinds: [
      { x402Version: 2, scheme: "session", network: config.network, extra },
      { x402Version: 1, scheme: "session", network: config.network, extra },
    ],
    extensions: [],
    signers: {
      "stellar:*": [facilitatorAddress],
    },
  };
  res.json(body);
}
