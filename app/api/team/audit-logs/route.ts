import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, users } from "../../../../db/schema";
import { getOwner, isResponse } from "../../../lib/permissions";

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (isResponse(owner)) return owner;
  const logs = await getDb().select({
    id: auditLogs.id,
    action: auditLogs.action,
    resourceType: auditLogs.resourceType,
    result: auditLogs.result,
    createdAt: auditLogs.createdAt,
    username: users.username,
  }).from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(eq(auditLogs.teamId, owner.teamId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
  return Response.json({ logs });
}
