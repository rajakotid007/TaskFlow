// Environment-based configuration. No secrets are hardcoded; defaults only
// point at the local Docker Compose services.
const env = process.env;

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://taskflow:taskflow@localhost:5432/taskflow_development',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Development-only simulation controls (forced outcomes). Never enabled in production.
  simulationControls: (env.ALLOW_SIMULATION_CONTROLS ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  // Routing simulation parameters (assessment rules).
  routing: {
    neverReturnRate: 0.2,
    minDelayMs: 5_000,
    maxDelayMs: 20_000,
    // A contributor counts as at capacity once they hold this many active assignments.
    defaultCapacity: 3,
  },
} as const;

export const REDIS_CHANNEL = 'taskflow:events';
export const ROUTING_QUEUE = 'taskflow-routing';
