// Point every test at the isolated test database. Must run before config is imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://claude:claude@localhost:5432/taskflow_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
