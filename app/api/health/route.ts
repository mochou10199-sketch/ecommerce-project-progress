import { sql } from "drizzle-orm";
import { getDb } from "../../../db";

const healthHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const db = getDb();
    if (typeof db.run === "function") await db.run(sql`SELECT 1`);
    else await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true, service: "ecommerce-project-progress-assistant" }, { headers: healthHeaders });
  } catch (error) {
    console.error("health check failed", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, service: "ecommerce-project-progress-assistant" }, { status: 503, headers: healthHeaders });
  }
}
