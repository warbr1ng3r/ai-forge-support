import { managerReply, replyToHandoff } from "../../../../../../lib/handoffs.ts";
import { managerCookieFrom, managerRequestOriginAllowed, managerSessionValid, readLimitedText } from "../../../../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const json = request.headers.get("accept")?.split(",").some(entry =>
    entry.split(";")[0].trim().toLowerCase() === "application/json");
  const failure = (error: string, status: number, nativeBody: string | null = error) => json
    ? Response.json({ error }, { status, headers })
    : new Response(nativeBody, { status, headers });

  if (!managerRequestOriginAllowed(request)) return failure("Откройте очередь менеджера и повторите отправку.", 403, null);
  if (!managerSessionValid(managerCookieFrom(request))) return failure("Войдите в раздел менеджера и повторите отправку.", 401, null);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return failure("Отправьте ответ через форму.", 415);
  }
  let body: string | null;
  try {
    body = await readLimitedText(request, 48 * 1024);
  } catch {
    return failure("Не удалось прочитать ответ.", 400);
  }
  if (body === null) return failure("Ответ слишком длинный.", 413);
  const form = new URLSearchParams(body);
  const parsed = managerReply.safeParse({ text: form.get("text"), replyId: form.get("replyId") });
  if (!parsed.success) return failure("Введите ответ от 1 до 4000 символов.", 400);
  try {
    const { id } = await params;
    const result = replyToHandoff(id, parsed.data);
    if (result === "notFound") return failure("Обращение не принимает ответы.", 404);
    if (result === "closed") return failure("Обращение уже закрыто.", 409);
    if (result === "conflict") return failure("Ответ с таким номером уже отправлен.", 409);
    if (json) return Response.json({ id: parsed.data.replyId }, { status: 201, headers });
    const page = new URL(request.url).searchParams.get("page");
    const queue = page && /^[1-9]\d{0,5}$/u.test(page) ? `/manager?page=${page}` : "/manager";
    return new Response(null, { status: 303, headers: { ...headers, Location: `${queue}#handoff-${id}` } });
  } catch {
    return failure("Очередь временно недоступна.", 503);
  }
}
