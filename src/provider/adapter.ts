import type { ChatCompletionRequest } from "../types.js";
import type { ProviderAdapter, UpstreamResponse } from "./types.js";

export type { ProviderAdapter, UpstreamResponse };

/**
 * Configuration options for creating provider adapters.
 */
export interface AdapterConfig {
  /** API key for the provider */
  apiKey: string;
  /** Base URL for the provider API */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Additional provider-specific options */
  options?: Record<string, unknown>;
}

/**
 * Abstract base providing the contract for upstream adapters.
 * Concrete adapters (OpenAI, Anthropic, etc.) implement execute() and healthCheck().
 *
 * Design Principles:
 * 1. Each adapter normalizes provider-specific responses to UpstreamResponse
 * 2. Error mapping transforms provider errors to gateway error types
 * 3. Timeout handling ensures bounded latency
 * 4. Health checks enable circuit breaker patterns
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  constructor(public readonly providerId: string) {}

  /**
   * Execute a chat completion request against the upstream provider.
   *
   * @param request - The chat completion request
   * @param modelId - The specific model to use (e.g., "gpt-4o", "claude-3-opus")
   * @returns Normalized upstream response
   * @throws UpstreamTimeoutError - When request exceeds timeout
   * @throws UpstreamUnavailableError - When provider is unreachable
   * @throws InternalError - For unexpected errors
   */
  abstract execute(
    request: ChatCompletionRequest,
    modelId: string,
  ): Promise<UpstreamResponse>;

  /**
   * Check if the upstream provider is healthy and reachable.
   * Used for circuit breaker and load balancing decisions.
   *
   * @returns true if provider is healthy, false otherwise
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Get provider metadata for observability.
   * Override to provide provider-specific information.
   */
  getMetadata(): Record<string, unknown> {
    return {
      provider: this.providerId,
      version: "1.0.0",
    };
  }
}

/**
 * Factory function type for creating provider adapters.
 * Enables dependency injection and testability.
 */
export type AdapterFactory = (config: AdapterConfig) => BaseProviderAdapter;

/**
 * Registry of adapter factories by provider ID.
 */
const adapterFactories = new Map<string, AdapterFactory>();

/**
 * Register an adapter factory for a provider type.
 * Called at module initialization to register concrete adapters.
 *
 * @param providerId - Unique identifier for the provider (e.g., "openai", "anthropic")
 * @param factory - Factory function that creates the adapter
 */
export function registerAdapterFactory(
  providerId: string,
  factory: AdapterFactory,
): void {
  adapterFactories.set(providerId, factory);
}

/**
 * Create a provider adapter using the registered factory.
 *
 * @param providerId - The provider identifier
 * @param config - Configuration for the adapter
 * @returns Configured adapter instance
 * @throws Error if no factory is registered for the provider
 */
export function createAdapter(
  providerId: string,
  config: AdapterConfig,
): BaseProviderAdapter {
  const factory = adapterFactories.get(providerId);
  if (!factory) {
    throw new Error(
      `No adapter factory registered for provider: ${providerId}`,
    );
  }
  return factory(config);
}

/**
 * List all registered provider IDs.
 *
 * @returns Array of registered provider identifiers
 */
export function listRegisteredProviders(): string[] {
  return Array.from(adapterFactories.keys());
}

/**
 * Check if an adapter factory is registered for a provider.
 *
 * @param providerId - The provider identifier to check
 * @returns true if registered, false otherwise
 */
export function isProviderRegistered(providerId: string): boolean {
  return adapterFactories.has(providerId);
}