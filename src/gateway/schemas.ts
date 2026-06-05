import { z } from 'zod';

/** Zod schema for OpenAI-compatible chat completion request body */
export const chatCompletionBodySchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    }),
  ).min(1),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional().default(false),
});

/** Zod schema for x402 payment headers (present on retry after 402) */
export const x402HeadersSchema = z.object({
  'x-402-challenge': z.string().optional(),
  'x-402-payment': z.string().optional(),
  'idempotency-key': z.string().uuid().optional(),
});

/** Zod schema for audit request path parameters */
export const auditParamsSchema = z.object({
  request_id: z.string().min(1),
});

export type ChatCompletionBody = z.infer<typeof chatCompletionBodySchema>;
export type X402Headers = z.infer<typeof x402HeadersSchema>;
export type AuditParams = z.infer<typeof auditParamsSchema>;
