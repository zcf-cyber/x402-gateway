import { describe, it, expect } from 'vitest';
import { buildTestApp } from '../helpers.js';

describe('API Integration', () => {
  describe('GET /v1/models', () => {
    it('should return empty model catalog', async () => {
      const app = buildTestApp();
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toEqual([]);
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should return 402 without payment headers', async () => {
      const app = buildTestApp();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(response.statusCode).toBe(402);
      const body = response.json();
      expect(body.error.code).toBe('payment_required');
      expect(body).toHaveProperty('payment_requirements');
    });
  });

  describe('GET /v1/audit/requests/:request_id', () => {
    it('should return 501 (not yet implemented)', async () => {
      const app = buildTestApp();
      const response = await app.inject({
        method: 'GET',
        url: '/v1/audit/requests/req_test123',
      });

      expect(response.statusCode).toBe(501);
    });
  });
});
