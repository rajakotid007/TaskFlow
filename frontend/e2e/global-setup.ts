import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Start every run from the same demo data so assertions are reproducible, and run the
// routing worker that delivers delayed results. The returned function stops the worker.
export default function globalSetup() {
  const backend = fileURLToPath(new URL('../../backend', import.meta.url));
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://taskflow:taskflow@localhost:5432/taskflow_development',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  } as Record<string, string>;

  execSync('npx tsx src/db/seed.ts', { cwd: backend, stdio: 'ignore', env });

  const worker: ChildProcess = spawn('npx', ['tsx', 'src/worker.ts'], { cwd: backend, env, stdio: 'ignore' });
  return async () => {
    worker.kill('SIGTERM');
  };
}
