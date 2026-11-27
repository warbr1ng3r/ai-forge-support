import { closeHandoff } from "../../../../../../lib/handoffs.ts";
import { managerCookieFrom, managerRequestOriginAllowed, managerSessionValid } from "../../../../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!managerRequestOriginAllowed(request)) return new Response(null, { status: 403, headers });
  if (!managerSessionValid(managerCookieFrom(request))) return new Response(null, { status: 401, headers });
  try {
    if (!closeHandoff((await params).id)) return new Response("Обращение не найдено.", { status: 404, headers });
    return new Response(null, { status: 303, headers: { ...headers, Location: "/manager" } });
  } catch {
    return new Response("Очередь временно недоступна.", { status: 503, headers });
  }
}
