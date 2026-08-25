import { getAuthUser, clearSessionCookie, revokeSession } from "../../../lib/server-auth";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (user) await revokeSession(request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
}
