import { getLocalDb, localDatabasePath } from "./local-sqlite";

export function setRuntimeEnv(value: Record<string, unknown>) {
  // Kept as a no-op so the archived Worker entry remains type-compatible.
  void value;
}

export function getDb() {
  return getLocalDb();
}

export { documentChunks, projectDocuments } from "./schema";
export { localDatabasePath };
