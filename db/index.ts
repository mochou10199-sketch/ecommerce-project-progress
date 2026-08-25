import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import postgres from "postgres";
import * as postgresSchema from "./postgres-schema";
import * as sqliteSchema from "./sqlite-schema";

type RuntimeEnv = Record<string, unknown> & { DB?: D1Database };
type SqlQuery = { sql: string; params: unknown[] };
type QueryBuilder = PromiseLike<unknown> & { toSQL(): SqlQuery };
type PostgresDb = ReturnType<typeof drizzlePostgres> & {
  batch(writes: QueryBuilder[]): Promise<unknown[]>;
};
type LegacyDb = ReturnType<typeof drizzleD1>;

let requestEnv: RuntimeEnv = {};
let postgresDb: PostgresDb | null = null;
let postgresClient: ReturnType<typeof postgres> | null = null;
let postgresUrl = "";

export function setRuntimeEnv(value: RuntimeEnv) {
  requestEnv = value;
}

function readEnv(name: string) {
  const fromRequest = requestEnv[name];
  if (typeof fromRequest === "string" && fromRequest) return fromRequest;
  if (fromRequest) return fromRequest;
  const runtimeProcess = typeof globalThis === "object" ? Reflect.get(globalThis, "process") : undefined;
  const runtimeEnv = runtimeProcess && typeof runtimeProcess === "object"
    ? Reflect.get(runtimeProcess, "env")
    : undefined;
  if (runtimeEnv && typeof runtimeEnv === "object") {
    const value = Reflect.get(runtimeEnv, name);
    if (value) return value;
  }
  return undefined;
}

function getPostgresDb(url: string) {
  if (!postgresDb || postgresUrl !== url) {
    const client = postgres(url, {
      // Supabase transaction poolers do not support prepared statements.
      prepare: false,
      max: 5,
    });
    const db = drizzlePostgres(client, { schema: postgresSchema }) as PostgresDb;
    // D1 exposes batch(); keep the call sites portable during the cutover,
    // while translating those Drizzle builders into one PostgreSQL transaction.
    db.batch = async (writes: QueryBuilder[]) => {
      if (!postgresClient) throw new Error("PostgreSQL 连接尚未初始化。");
      const queries = writes.map((write) => write.toSQL());
      return postgresClient.begin(async (transaction) => {
        const results: unknown[] = [];
        for (const query of queries) {
          results.push(await transaction.unsafe(query.sql, query.params));
        }
        return results;
      });
    };
    postgresClient = client;
    postgresDb = db;
    postgresUrl = url;
  }
  return postgresDb;
}

export function getDb(): PostgresDb | LegacyDb {
  const databaseUrl = readEnv("DATABASE_URL");
  if (typeof databaseUrl === "string" && databaseUrl) return getPostgresDb(databaseUrl);

  const d1 = readEnv("DB") as D1Database | undefined;
  if (!d1) {
    throw new Error(
      "数据库连接不可用。Node/Vinext 运行需要 DATABASE_URL；Cloudflare 兼容预览需要 DB 绑定。"
    );
  }
  return drizzleD1(d1, { schema: sqliteSchema });
}
