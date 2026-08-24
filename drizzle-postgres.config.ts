import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/postgres-schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Schema generation does not connect to the database. Commands that read
    // or apply migrations must receive the real DATABASE_URL explicitly.
    url: process.env.DATABASE_URL ?? "postgres://localhost/ecommerce_progress_migration_local",
  },
});
