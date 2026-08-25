import { getAuthUser } from "../../../lib/server-auth";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user });
}
