import { managerReply, replyToHandoff } from "../../../../../../lib/handoffs.ts";
import { managerCookieFrom, managerRequestOriginAllowed, managerSessionValid, readLimitedText } from "../../../../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!managerRequestOriginAllowed(request)) return new Response(null, { status: 403, headers });
  if (!managerSessionValid(managerCookieFrom(request))) return new Response(null, { status: 401, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new Response("Отправьте ответ через форму.", { status: 415, headers });
  }
  let body: string | null;
  try {
    body = await readLimitedText(request, 48 * 1024);
  } catch {
    return new Response("Не удалось прочитать ответ.", { status: 400, headers });
  }
  if (body === null) return new Response("Ответ слишком длинный.", { status: 413, headers });
  const form = new URLSearchParams(body);
  const parsed = managerReply.safeParse({ text: form.get("text"), replyId: form.get("replyId") });
  if (!parsed.success) return new Response("Введите ответ от 1 до 4000 символов.", { status: 400, headers });
  try {
    const { id } = await params;
    const result = replyToHandoff(id, parsed.data);
    if (result === "notFound") return new Response("Обращение не принимает ответы.", { status: 404, headers });
    if (result === "closed") return new Response("Обращение уже закрыто.", { status: 409, headers });
    if (result === "conflict") return new Response("Ответ с таким номером уже отправлен.", { status: 409, headers });
    const page = new URL(request.url).searchParams.get("page");
    const queue = page && /^[1-9]\d{0,5}$/u.test(page) ? `/manager?page=${page}` : "/manager";
    return new Response(null, { status: 303, headers: { ...headers, Location: `${queue}#handoff-${id}` } });
  } catch {
    return new Response("Очередь временно недоступна.", { status: 503, headers });
  }
}
