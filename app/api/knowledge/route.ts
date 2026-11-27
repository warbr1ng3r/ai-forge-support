import { knowledgeEntry, publishKnowledge } from "../../../lib/knowledge.ts";
import { managerCookieFrom, managerRequestOriginAllowed, managerSessionValid, readLimitedText } from "../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const json = request.headers.get("accept")?.split(",").some(entry =>
    entry.split(";")[0].trim().toLowerCase() === "application/json");
  const failure = (error: string, status: number) => json
    ? Response.json({ error }, { status, headers })
    : new Response(error, { status, headers });
  if (!managerRequestOriginAllowed(request) || !managerSessionValid(managerCookieFrom(request))) {
    return failure("Войдите в раздел менеджера.", 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return failure("Некорректный формат формы.", 415);
  }
  let body: string | null;
  try {
    body = await readLimitedText(request, 16_000);
  } catch {
    return failure("Форму не удалось прочитать.", 400);
  }
  if (body === null) return failure("Слишком длинная статья.", 413);
  const entry = knowledgeEntry.safeParse(Object.fromEntries(new URLSearchParams(body)));
  if (!entry.success) {
    if (json) return failure("Проверьте название, ключевые фразы, текст и ссылку на источник.", 422);
    return new Response(null, { status: 303, headers: { ...headers, Location: "/manager/knowledge?status=invalid" } });
  }
  try {
    const id = publishKnowledge(entry.data);
    if (json) return Response.json({ id }, { status: 201, headers });
    return new Response(null, { status: 303, headers: { ...headers, Location: "/manager/knowledge?status=published" } });
  } catch {
    return failure("Не удалось сохранить статью. Попробуйте ещё раз.", 503);
  }
}
