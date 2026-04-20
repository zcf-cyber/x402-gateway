import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildMockedTestApp,
  createMockPaymentProof,
  encodePaymentProof,
} from "../helpers.js";

/**
 * P5 Performance Load Tests
 *
 * Target metrics:
 * - Load: 20 RPS (requests per second)
 * - Duration: 10 minutes
 * - Error rate: <1%
 * - Tests complete 402 flow: challenge -> pay -> success
 */

describe("Performance Load Tests", () => {
  describe("20 RPS Load Test - Full 402 Flow", () => {
    // Configuration
    const TARGET_RPS = 20;
    const TEST_DURATION_MS = 10 * 60 * 1000; // 10 minutes
    const MAX_ERROR_RATE = 0.01; // 1%
    const REQUEST_INTERVAL_MS = 1000 / TARGET_RPS;

    it(
      `should sustain ${TARGET_RPS} RPS for ${TEST_DURATION_MS / 60000} minutes with <${MAX_ERROR_RATE * 100}% error rate`,
      async () => {
        const { app } = buildMockedTestApp();
        const results: {
          success: boolean;
          latencyMs: number;
          statusCode?: number;
          error?: string;
        }[] = [];

        const startTime = Date.now();
        let requestCount = 0;
        const maxRequests = Math.floor(
          (TEST_DURATION_MS / 1000) * TARGET_RPS * 1.1,
        ); // Allow 10% buffer

        // Track challenge tokens and payment proofs for each request
        const requestData: Map<
          number,
          { challengeToken: string; paymentHeader: string }
        > = new Map();

        // Send requests at target RPS rate
        while (
          Date.now() - startTime < TEST_DURATION_MS &&
          requestCount < maxRequests
        ) {
          const requestStartTime = Date.now();
          const currentRequestId = requestCount++;

          try {
            // Step 1: Get challenge (initial request without payment)
            const challengeResponse = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  {
                    role: "user",
                    content: `Load test message ${currentRequestId}`,
                  },
                ],
              },
            });

            if (challengeResponse.statusCode !== 402) {
              results.push({
                success: false,
                latencyMs: Date.now() - requestStartTime,
                statusCode: challengeResponse.statusCode,
                error: `Expected 402, got ${challengeResponse.statusCode}`,
              });
              continue;
            }

            const challengeBody = challengeResponse.json();
            const challengeToken =
              challengeBody.payment_requirements.challenge_token;

            // Step 2: Submit payment with challenge token
            const paymentProof = createMockPaymentProof({
              tx_hash: `0x${currentRequestId.toString(16).padStart(64, "a")}`,
            });
            const paymentHeader = encodePaymentProof(paymentProof);

            const successResponse = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  {
                    role: "user",
                    content: `Load test message ${currentRequestId}`,
                  },
                ],
              },
              headers: {
                "x-402-challenge": challengeToken,
                "x-402-payment": paymentHeader,
              },
            });

            const totalLatency = Date.now() - requestStartTime;

            if (successResponse.statusCode === 200) {
              const body = successResponse.json();
              results.push({
                success: true,
                latencyMs: totalLatency,
                statusCode: 200,
              });

              // Verify receipt structure
              expect(body.usage_receipt).toBeDefined();
              expect(body.usage_receipt.request_id).toBeDefined();
              expect(body.usage_receipt.total_cost_usd).toBeDefined();
            } else {
              results.push({
                success: false,
                latencyMs: totalLatency,
                statusCode: successResponse.statusCode,
                error: `Expected 200, got ${successResponse.statusCode}`,
              });
            }
          } catch (error) {
            results.push({
              success: false,
              latencyMs: Date.now() - requestStartTime,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          // Maintain target RPS rate
          const elapsed = Date.now() - requestStartTime;
          const sleepTime = REQUEST_INTERVAL_MS - elapsed;
          if (sleepTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, sleepTime));
          }
        }

        // Calculate metrics
        const totalRequests = results.length;
        const successfulRequests = results.filter((r) => r.success).length;
        const failedRequests = totalRequests - successfulRequests;
        const errorRate = failedRequests / totalRequests;
        const latencies = results.map((r) => r.latencyMs);
        const avgLatency =
          latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const minLatency = Math.min(...latencies);
        const maxLatency = Math.max(...latencies);
        // Sort once for all percentile calculations (fix: avoid repeated sorting)
        const sortedLatencies = [...latencies].sort((a, b) => a - b);
        const p50Latency =
          sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
        const p95Latency =
          sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
        const p99Latency =
          sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];

        // Log performance metrics
        console.log("\n========== Performance Test Results ==========");
        console.log(`Duration: ${(Date.now() - startTime) / 1000}s`);
        console.log(`Total Requests: ${totalRequests}`);
        console.log(`Successful Requests: ${successfulRequests}`);
        console.log(`Failed Requests: ${failedRequests}`);
        console.log(`Error Rate: ${(errorRate * 100).toFixed(2)}%`);
        console.log(`Target Error Rate: <${MAX_ERROR_RATE * 100}%`);
        console.log(`\nLatency Metrics:`);
        console.log(`  Min: ${minLatency}ms`);
        console.log(`  Avg: ${avgLatency.toFixed(2)}ms`);
        console.log(`  Max: ${maxLatency}ms`);
        console.log(`  P50: ${p50Latency}ms`);
        console.log(`  P95: ${p95Latency}ms`);
        console.log(`  P99: ${p99Latency}ms`);
        console.log(`Target RPS: ${TARGET_RPS}`);
        console.log(
          `Actual RPS: ${(totalRequests / ((Date.now() - startTime) / 1000)).toFixed(2)}`,
        );
        console.log("==============================================\n");

        // Assertions
        expect(totalRequests).toBeGreaterThan(0);
        expect(errorRate).toBeLessThan(MAX_ERROR_RATE);
        expect(successfulRequests).toBeGreaterThan(0);

        // Verify error rate is within acceptable bounds
        const errorRatePercent = errorRate * 100;
        const targetErrorRatePercent = MAX_ERROR_RATE * 100;
        expect(errorRatePercent).toBeLessThan(targetErrorRatePercent);
      },
      TEST_DURATION_MS + 60000, // Test timeout: duration + 1 minute buffer
    );
  });

  describe("Burst Load Test - 50 RPS Spike", () => {
    const BURST_RPS = 50;
    const BURST_DURATION_MS = 30 * 1000; // 30 seconds
    const REQUEST_INTERVAL_MS = 1000 / BURST_RPS;

    it(
      `should handle ${BURST_RPS} RPS burst for ${BURST_DURATION_MS / 1000}s`,
      async () => {
        const { app } = buildMockedTestApp();
        const results: { success: boolean; latencyMs: number }[] = [];

        const startTime = Date.now();
        let requestCount = 0;

        while (Date.now() - startTime < BURST_DURATION_MS) {
          const requestStartTime = Date.now();
          const currentRequestId = requestCount++;

          try {
            // Get challenge
            const challengeResponse = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  { role: "user", content: `Burst test ${currentRequestId}` },
                ],
              },
            });

            if (challengeResponse.statusCode !== 402) {
              results.push({
                success: false,
                latencyMs: Date.now() - requestStartTime,
              });
              continue;
            }

            const challengeToken =
              challengeResponse.json().payment_requirements.challenge_token;
            const paymentProof = createMockPaymentProof({
              tx_hash: `0xburst${currentRequestId.toString(16).padStart(60, "b")}`,
            });
            const paymentHeader = encodePaymentProof(paymentProof);

            // Submit payment
            const successResponse = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  { role: "user", content: `Burst test ${currentRequestId}` },
                ],
              },
              headers: {
                "x-402-challenge": challengeToken,
                "x-402-payment": paymentHeader,
              },
            });

            results.push({
              success: successResponse.statusCode === 200,
              latencyMs: Date.now() - requestStartTime,
            });
          } catch {
            results.push({
              success: false,
              latencyMs: Date.now() - requestStartTime,
            });
          }

          // Maintain burst rate
          const elapsed = Date.now() - requestStartTime;
          const sleepTime = REQUEST_INTERVAL_MS - elapsed;
          if (sleepTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, sleepTime));
          }
        }

        const totalRequests = results.length;
        const successfulRequests = results.filter((r) => r.success).length;
        const errorRate = (totalRequests - successfulRequests) / totalRequests;
        const avgLatency =
          results.reduce((a, r) => a + r.latencyMs, 0) / totalRequests;

        console.log("\n========== Burst Test Results ==========");
        console.log(`Duration: ${BURST_DURATION_MS / 1000}s`);
        console.log(`Total Requests: ${totalRequests}`);
        console.log(`Successful: ${successfulRequests}`);
        console.log(`Error Rate: ${(errorRate * 100).toFixed(2)}%`);
        console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
        console.log("========================================\n");

        expect(totalRequests).toBeGreaterThan(0);
        expect(errorRate).toBeLessThan(0.05); // Allow 5% error rate for burst
      },
      BURST_DURATION_MS + 30000, // Timeout with buffer
    );
  });

  describe("Idempotency Load Test", () => {
    const IDEMPOTENCY_RPS = 10;
    const IDEMPOTENCY_DURATION_MS = 60 * 1000; // 1 minute
    const REQUEST_INTERVAL_MS = 1000 / IDEMPOTENCY_RPS;

    it(
      `should maintain idempotency consistency at ${IDEMPOTENCY_RPS} RPS`,
      async () => {
        // Fix: Get services to verify server-side idempotency (ledger entries)
        const { app, services } = buildMockedTestApp();

        // Track idempotency key info: request_id and ledger verification status
        const idempotencyKeyInfo = new Map<
          string,
          { requestId: string; ledgerVerified: boolean }
        >();
        const results: {
          success: boolean;
          isDuplicate: boolean;
          requestIdMatch?: boolean;
        }[] = [];

        const startTime = Date.now();
        let requestCount = 0;

        while (Date.now() - startTime < IDEMPOTENCY_DURATION_MS) {
          const currentRequestId = requestCount++;
          const idempotencyKey = `perf-idem-${Math.floor(currentRequestId / 2)}`; // Reuse keys

          try {
            // Get challenge
            const challengeResponse = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  {
                    role: "user",
                    content: `Idempotency test ${currentRequestId}`,
                  },
                ],
              },
            });

            const challengeToken =
              challengeResponse.json().payment_requirements.challenge_token;
            const paymentProof = createMockPaymentProof({
              tx_hash: `0xidem${currentRequestId.toString(16).padStart(60, "c")}`,
            });
            const paymentHeader = encodePaymentProof(paymentProof);

            // Submit with idempotency key
            const response = await app.inject({
              method: "POST",
              url: "/v1/chat/completions",
              payload: {
                model: "openai/gpt-4o",
                messages: [
                  {
                    role: "user",
                    content: `Idempotency test ${currentRequestId}`,
                  },
                ],
              },
              headers: {
                "x-402-challenge": challengeToken,
                "x-402-payment": paymentHeader,
                "idempotency-key": idempotencyKey,
              },
            });

            if (response.statusCode === 200) {
              const body = response.json();
              const requestId = body.usage_receipt.request_id;

              // Check if this is a duplicate request
              const isDuplicate = idempotencyKeyInfo.has(idempotencyKey);

              if (!isDuplicate) {
                // First request: store request_id for later comparison
                idempotencyKeyInfo.set(idempotencyKey, {
                  requestId,
                  ledgerVerified: false,
                });
              } else {
                // Duplicate request: verify request_id matches first request
                const firstRequestInfo =
                  idempotencyKeyInfo.get(idempotencyKey)!;
                results.push({
                  success: true,
                  isDuplicate: true,
                  requestIdMatch: requestId === firstRequestInfo.requestId,
                });
                continue;
              }

              results.push({
                success: true,
                isDuplicate: false,
              });
            } else {
              results.push({ success: false, isDuplicate: false });
            }
          } catch {
            results.push({ success: false, isDuplicate: false });
          }

          const sleepTime =
            REQUEST_INTERVAL_MS -
            ((Date.now() - startTime) % REQUEST_INTERVAL_MS);
          if (sleepTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, sleepTime));
          }
        }

        // Verify server-side idempotency
        // Fix: Verify that duplicate requests return the same request_id
        const duplicateResults = results.filter((r) => r.isDuplicate);
        const allDuplicatesMatch = duplicateResults.every(
          (r) => r.requestIdMatch === true,
        );

        // Fix: Verify ledger entries for idempotency keys
        let ledgerCount = 0;
        for (const [_, info] of idempotencyKeyInfo) {
          const ledgerEntry = await services.ledgerService.getByRequestId(
            info.requestId,
          );
          if (ledgerEntry) {
            ledgerCount++;
          }
        }

        const successfulRequests = results.filter((r) => r.success).length;
        const duplicateRequests = duplicateResults.length;

        console.log("\n========== Idempotency Test Results ==========");
        console.log(`Total Requests: ${results.length}`);
        console.log(`Successful: ${successfulRequests}`);
        console.log(`First-time Requests: ${idempotencyKeyInfo.size}`);
        console.log(`Duplicate Requests: ${duplicateRequests}`);
        console.log(`All Duplicate request_id Match: ${allDuplicatesMatch}`);
        console.log(`Ledger Entries Created: ${ledgerCount}`);
        console.log("==============================================\n");

        // Fix: Verify all duplicate requests have matching request_id
        if (duplicateResults.length > 0) {
          expect(allDuplicatesMatch).toBe(true);
        }

        // Fix: Verify ledger has correct number of entries (one per unique idempotency key)
        expect(ledgerCount).toBe(idempotencyKeyInfo.size);

        // All requests should succeed (including duplicates)
        expect(successfulRequests).toBe(results.length);
      },
      IDEMPOTENCY_DURATION_MS + 30000,
    );
  });
});
