import type { FastifyRequest, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import type { RequestId } from '../types.js';

/**
 * Fastify onRequest hook: inject a unique trace/request ID.
 * Attaches the ID to request.id for downstream use.
 */
export async function traceIdHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const id = `req_${nanoid()}` as RequestId;
  request.id = id;
}
