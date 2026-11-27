import { managerAccessConfigured, managerRequestOriginAllowed, managerSessionCookie, readLimitedText, signInManager } from "../../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!managerRequestOriginAllowed(request)) return new Response(null, { status: 403, headers });
  if (!managerAccessConfigured()) return new Response("Доступ менеджера пока не настроен.", { status: 503, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new Response(null, { status: 415, headers });
  }

  let body: string | null;
  try {
    body = await readLimitedText(request, 4096);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  if (body === null) return new Response(null, { status: 413, headers });
  const form = new URLSearchParams(body);
  const token = form.get("token");
  const session = form.get("action") === "logout" ? "" : token ? signInManager(token) : undefined;
  if (session === undefined) {
    return new Response(null, { status: 303, headers: { ...headers, Location: "/manager?error=login" } });
  }
  return new Response(null, { status: 303, headers: {
    ...headers, Location: "/manager", "Set-Cookie": managerSessionCookie(request, session),
  } });
}
