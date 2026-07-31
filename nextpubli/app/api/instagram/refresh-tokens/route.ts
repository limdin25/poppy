import { NextResponse } from "next/server";
import {
  getExpiringConnections,
  updateInstagramToken,
  disconnectInstagram,
} from "@/lib/data/instagram";
import { refreshLongLivedToken } from "@/lib/integrations/instagram";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const connections = await getExpiringConnections(7);
  const results: { id: string; username: string; status: string }[] = [];

  for (const conn of connections) {
    try {
      const { access_token, expires_in } = await refreshLongLivedToken(conn.access_token);
      await updateInstagramToken(conn.id, access_token, expires_in);
      results.push({ id: conn.id, username: conn.ig_username, status: "refreshed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error(`Token refresh failed for ${conn.ig_username}:`, message);
      await disconnectInstagram(conn.id);
      results.push({
        id: conn.id,
        username: conn.ig_username,
        status: `failed: ${message}`,
      });
    }
  }

  return NextResponse.json({
    processed: connections.length,
    results,
  });
}
