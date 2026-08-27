-- Runs once, when the postgres volume is first created.
-- Integration tests (pnpm test:integration) use a separate database so they
-- can truncate tables freely without touching your dev data.
CREATE DATABASE habit_tracker_test;
