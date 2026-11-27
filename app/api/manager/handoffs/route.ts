import { addHandoff, customerHandoff } from "../../../../lib/handoffs.ts";
import { managerRequestOriginAllowed, readLimitedText } from "../../../../lib/manager-auth.ts";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!managerRequestOriginAllowed(request)) return new Response(null, { status: 403, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Приложите текст обращения в формате JSON." }, { status: 415, headers });
  }

  let payload: unknown;
  try {
    const body = await readLimitedText(request, 96 * 1024);
    if (body === null) return Response.json({ error: "Диалог слишком большой." }, { status: 413, headers });
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "Не удалось прочитать обращение." }, { status: 400, headers });
  }
  const parsed = customerHandoff.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Укажите причину и приложите диалог допустимой длины." }, { status: 400, headers });
  }

  try {
    const saved = addHandoff({ ...parsed.data, source: "customer" });
    if (!saved) return Response.json({ error: "Этот номер обращения уже занят." }, { status: 409, headers });
    return Response.json(saved, { status: 201, headers });
  } catch {
    return Response.json({ error: "Очередь временно недоступна." }, { status: 503, headers });
  }
}
