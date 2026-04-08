/** Data signed into the challenge_token (HMAC via jose) */
export interface ChallengePayload {
  quote_id: string;
  request_hash: string;
  amount: string;
  asset: string;
  chain: string;
  merchant_address: string;
  expires_at: string;
}

/** Decoded X-402-Payment header */
export interface PaymentProof {
  tx_hash: string;
  chain: string;
  payer_address: string;
}

/** 402 response body shape (API spec section 3.2) */
export interface PaymentRequirements {
  quote_id: string;
  chain: string;
  asset: string;
  amount: string;
  expires_at: string;
  merchant_address: string;
  request_hash: string;
  challenge_token: string;
}

/** Result of on-chain payment verification */
export interface VerificationResult {
  verified: boolean;
  payer_address: string;
  amount: string;
}
