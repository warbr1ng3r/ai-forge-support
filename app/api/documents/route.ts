import { commerceDocumentRequest, createCommerceDocument } from "../../../lib/commerce-documents.ts";
import { recordSupportEvent } from "../../../lib/knowledge.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const reader = request.body?.pipeThrough(new TextDecoderStream()).getReader();
  let body = "";
  let payload: unknown;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      if (body.length + value.length > 4096) {
        void reader.cancel().catch(() => {});
        return new Response("Данные документа слишком велики.", { status: 413 });
      }
      body += value;
    }
    payload = JSON.parse(body);
  } catch {
    return new Response("Не удалось прочитать данные документа.", { status: 400 });
  } finally {
    reader?.releaseLock();
  }

  const parsed = commerceDocumentRequest.safeParse(payload);
  if (!parsed.success) {
    return new Response("Проверьте количество, название покупателя и ИНН.", { status: 400 });
  }
  try {
    const result = createCommerceDocument(parsed.data);
    if ("error" in result) return new Response(result.error, { status: result.status });
    try {
      const { offerId, quantity, type } = parsed.data;
      recordSupportEvent(type === "quote" ? "Сформировано КП" : "Сформирован проект счёта", { offerId, count: quantity });
    } catch {
      console.warn("Не удалось записать событие подготовки документа.");
    }
    return new Response(result.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Каталог пока недоступен. Попробуйте позже.", { status: 503 });
  }
}
