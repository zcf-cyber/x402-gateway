import { describe, it, expect } from 'vitest';
import { createChallengeService } from '../../src/x402/challenge.service.js';

describe('ChallengeService', () => {
  const service = createChallengeService({
    challengeSecret: 'test-secret-at-least-32-chars-long-for-testing',
    challengeTtlSeconds: 300,
    merchantAddress: '0x0000000000000000000000000000000000000001',
    paymentChain: 'base',
    paymentAsset: 'USDC',
  });

  it('should exist and have the expected interface', () => {
    expect(service).toBeDefined();
    expect(typeof service.generateChallenge).toBe('function');
    expect(typeof service.verifyChallenge).toBe('function');
    expect(typeof service.computeRequestHash).toBe('function');
  });

  it('generateChallenge should throw Not implemented', async () => {
    const request = {
      model: 'gpt-4',
      messages: [{ role: 'user' as const, content: 'hello' }],
    };
    await expect(service.generateChallenge(request, '0.001')).rejects.toThrow('Not implemented');
  });
});
