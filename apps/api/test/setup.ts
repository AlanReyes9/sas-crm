process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://nexus:nexus@localhost:5432/nexus_test";
process.env.DISABLE_SCHEDULER = "1";
process.env.JWT_SECRET = "test-secret";
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.ANTHROPIC_API_KEY = "";
