import { readHandoffReplies } from "../../../../../lib/handoffs.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!key) return new Response(null, { status: 404, headers });
  try {
    const status = readHandoffReplies((await params).id, key);
    return status ? Response.json(status, { headers }) : new Response(null, { status: 404, headers });
  } catch {
    return new Response("Очередь временно недоступна.", { status: 503, headers });
  }
}
