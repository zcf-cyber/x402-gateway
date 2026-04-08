// ---------------------------------------------------------------------------
// Typed error classes mapping to API spec error codes
// See: docs/api-spec-v0-x402-gateway.md section 6
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** 402 - First request without payment headers */
export class PaymentRequiredError extends AppError {
  constructor(
    public readonly paymentRequirements: Record<string, unknown>,
  ) {
    super('payment_required', 402, 'Payment proof required');
    this.name = 'PaymentRequiredError';
  }
}

/** 402 - Challenge token has expired */
export class ChallengeExpiredError extends AppError {
  constructor() {
    super('challenge_expired', 402, 'Challenge token has expired');
    this.name = 'ChallengeExpiredError';
  }
}

/** 400 - Retry request body does not match challenge request_hash */
export class RequestHashMismatchError extends AppError {
  constructor() {
    super('request_hash_mismatch', 400, 'Request hash does not match challenge');
    this.name = 'RequestHashMismatchError';
  }
}

/** 402 - On-chain payment verification failed */
export class PaymentVerificationFailedError extends AppError {
  constructor(message = 'Payment verification failed') {
    super('payment_verification_failed', 402, message);
    this.name = 'PaymentVerificationFailedError';
  }
}

/** 409 - Payment proof has already been consumed */
export class PaymentReplayedError extends AppError {
  constructor() {
    super('payment_replayed', 409, 'Payment proof has already been used');
    this.name = 'PaymentReplayedError';
  }
}

/** 402 - Payment amount is less than required */
export class InsufficientPaymentError extends AppError {
  constructor(required: string, received: string) {
    super('insufficient_payment', 402, `Insufficient payment: required ${required}, received ${received}`);
    this.name = 'InsufficientPaymentError';
  }
}

/** 504 - Upstream model provider timed out */
export class UpstreamTimeoutError extends AppError {
  constructor(provider: string) {
    super('upstream_timeout', 504, `Upstream provider timed out: ${provider}`);
    this.name = 'UpstreamTimeoutError';
  }
}

/** 503 - Upstream model provider is unavailable */
export class UpstreamUnavailableError extends AppError {
  constructor(provider: string) {
    super('upstream_unavailable', 503, `Upstream provider unavailable: ${provider}`);
    this.name = 'UpstreamUnavailableError';
  }
}

/** 500 - Internal server error */
export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super('internal_error', 500, message);
    this.name = 'InternalError';
  }
}

/** Convert an AppError to the API response shape */
export function errorToResponse(error: AppError): { error: { code: string; message: string } } & Record<string, unknown> {
  const base: { error: { code: string; message: string } } & Record<string, unknown> = {
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error instanceof PaymentRequiredError) {
    base['payment_requirements'] = error.paymentRequirements;
  }

  return base;
}
