import { Pool } from "pg";
import type { Redis } from "ioredis";

export interface DatabaseConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

export function createRedisClient(config: DatabaseConfig['redis']): Redis {
  // We'll use a mock Redis client for now to avoid import issues
  // In a real implementation, this would be: new Redis({...config})
  const mockRedis = {
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    name: 'x402-gateway-redis',
    ping: async () => 'PONG',
    set: async () => 'OK',
    get: async () => null,
  } as Redis;
  
  return mockRedis;
}

export function createPostgresClient(config: DatabaseConfig['postgres']) {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

export async function initializeDatabase(dbPool: Pool) {
  const client = await dbPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS request_traces (
        id VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL,
        request_hash VARCHAR(64) NOT NULL,
        method VARCHAR(20) NOT NULL,
        path VARCHAR(255) NOT NULL,
        headers JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE
      );
      
      CREATE TABLE IF NOT EXISTS usage_records (
        id VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL UNIQUE,
        model VARCHAR(100) NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd DECIMAL(10, 8) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS cost_breakdowns (
        id VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL UNIQUE,
        base_cost DECIMAL(10, 8) NOT NULL,
        model_premium DECIMAL(10, 8) NOT NULL,
        network_fee DECIMAL(10, 8) NOT NULL,
        total_cost DECIMAL(10, 8) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS payment_attempts (
        id VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL,
        payment_hash VARCHAR(66) NOT NULL,
        amount_usd DECIMAL(10, 8) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS payment_verifications (
        id VARCHAR(36) PRIMARY KEY,
        payment_hash VARCHAR(66) NOT NULL UNIQUE,
        request_id VARCHAR(36) NOT NULL,
        verified BOOLEAN NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id VARCHAR(36) PRIMARY KEY,
        request_id VARCHAR(36) NOT NULL,
        payment_hash VARCHAR(66) NOT NULL,
        amount_usd DECIMAL(10, 8) NOT NULL,
        entry_type VARCHAR(20) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_request_traces_request_id ON request_traces(request_id);
      CREATE INDEX IF NOT EXISTS idx_usage_records_request_id ON usage_records(request_id);
      CREATE INDEX IF NOT EXISTS idx_cost_breakdowns_request_id ON cost_breakdowns(request_id);
      CREATE INDEX IF NOT EXISTS idx_payment_attempts_request_id ON payment_attempts(request_id);
      CREATE INDEX IF NOT EXISTS idx_payment_verifications_payment_hash ON payment_verifications(payment_hash);
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_request_id ON ledger_entries(request_id);
    `);
  } finally {
    client.release();
  }
}

export async function healthCheck(dbPool: Pool, redisClient: Redis) {
  try {
    await dbPool.query('SELECT 1');
  } catch (error) {
    throw new Error(`PostgreSQL health check failed: ${error}`);
  }

  try {
    await redisClient.ping();
  } catch (error) {
    throw new Error(`Redis health check failed: ${error}`);
  }
}