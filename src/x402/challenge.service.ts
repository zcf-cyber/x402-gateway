import { createHash } from "crypto";
import type { ChatCompletionRequest } from "../types.js";
import type { PaymentRequirements, ChallengePayload } from "./types.js";
import { ChallengeExpiredError, RequestHashMismatchError } from "../errors.js";

export interface IChallengeService {
  generateChallenge(
    request: ChatCompletionRequest,
    estimatedCost: string,
  ): Promise<PaymentRequirements>;
  verifyChallenge(
    challengeToken: string,
    requestBody: ChatCompletionRequest,
  ): Promise<ChallengePayload>;
  computeRequestHash(body: ChatCompletionRequest): string;
}

export function createChallengeService(deps: {
  challengeSecret: string;
  challengeTtlSeconds: number;
  merchantAddress: string;
  paymentChain: string;
  paymentAsset: string;
}): IChallengeService {
  const {
    challengeSecret,
    challengeTtlSeconds,
    merchantAddress,
    paymentChain,
    paymentAsset,
  } = deps;

  return {
    generateChallenge: async function (
      request: ChatCompletionRequest,
      estimatedCost: string,
    ): Promise<PaymentRequirements> {
      const { nanoid } = await import("nanoid");
      const quoteId = nanoid();
      const requestHash = this.computeRequestHash(request);

      const payload: ChallengePayload = {
        quote_id: quoteId,
        request_hash: requestHash,
        amount: estimatedCost,
        asset: paymentAsset,
        chain: paymentChain,
        merchant_address: merchantAddress,
        expires_at: new Date(
          Date.now() + challengeTtlSeconds * 1000,
        ).toISOString(),
      };

      const { createHmac } = await import("crypto");
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(payload));
      const signature = createHmac("sha256", challengeSecret)
        .update(data)
        .digest("base64url");
      const challengeToken = `${signature}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

      return {
        ...payload,
        challenge_token: challengeToken,
      };
    },

    verifyChallenge: async function (
      challengeToken: string,
      requestBody: ChatCompletionRequest,
    ): Promise<ChallengePayload> {
      const [signaturePart, payloadPart] = challengeToken.split(".");
      if (!signaturePart || !payloadPart)
        throw new Error("Invalid challenge token format");

      try {
        const payloadData = Buffer.from(payloadPart, "base64url");
        const decoder = new TextDecoder();
        const payloadString = decoder.decode(payloadData);
        let parsedPayload;
        try {
          parsedPayload = JSON.parse(payloadString);
        } catch {
          throw new Error("Invalid challenge token format");
        }

        const { createHmac, timingSafeEqual } = await import("crypto");
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadString);
        const expectedSignature = createHmac("sha256", challengeSecret)
          .update(data)
          .digest();
        const signatureBuffer = Buffer.from(signaturePart, "base64url");

        if (
          signatureBuffer.length !== expectedSignature.length ||
          !timingSafeEqual(signatureBuffer, expectedSignature)
        ) {
          throw new Error("Invalid challenge signature");
        }

        const expiresAt = new Date(parsedPayload.expires_at);
        if (Date.now() > expiresAt.getTime()) throw new ChallengeExpiredError();

        const recomputedHash = this.computeRequestHash(requestBody);
        if (recomputedHash !== parsedPayload.request_hash)
          throw new RequestHashMismatchError();

        // Ensure the returned object matches ChallengePayload type
        return {
          quote_id: parsedPayload.quote_id,
          request_hash: parsedPayload.request_hash,
          amount: parsedPayload.amount,
          asset: parsedPayload.asset,
          chain: parsedPayload.chain,
          merchant_address: parsedPayload.merchant_address,
          expires_at: parsedPayload.expires_at,
        };
      } catch (error) {
        if (
          error instanceof ChallengeExpiredError ||
          error instanceof RequestHashMismatchError
        )
          throw error;
        throw error;
      }
    },

    computeRequestHash: function (body: ChatCompletionRequest): string {
      const sortedKeys = Object.keys(body).sort();
      const objWithSortedKeys: Record<string, unknown> = {};
      for (const key of sortedKeys)
        objWithSortedKeys[key] = (body as unknown as Record<string, unknown>)[
          key
        ];
      const sortedBody = JSON.stringify(objWithSortedKeys, null, 2);
      const hash = createHash("sha256").update(sortedBody).digest("hex");
      return `rh_${hash}`;
    },
  };
}