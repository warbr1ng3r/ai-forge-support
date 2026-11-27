import { existsSync } from "node:fs";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import { z } from "zod";
import { catalogPath, quantityBounds, type Offer } from "../../../lib/catalog.ts";
import { recordConsultation } from "../../../lib/knowledge.ts";
import { agentId, createSupport, summarizeCatalogGroups } from "../../../lib/support.ts";
import { catalogPriceUnit } from "../../../lib/store-faq.ts";

export const runtime = "nodejs";

const textPart = z.object({ type: z.literal("text"), text: z.string().max(6000) });
const chatBody = z.object({
  messages: z.array(z.object({
    id: z.string().min(1).max(150),
    role: z.enum(["user", "assistant"]),
    parts: z.array(textPart).min(1).max(100),
  })).min(1).max(16),
  previousOfferIds: z.array(z.string().regex(/^\d{1,16}$/)).max(12).default([]),
});

const purchaseQualifiers = String.raw`(?:(?:у\s+вас|сейчас|сегодня|ещ[её])\s+){0,3}`;
const availabilityQuestion = new RegExp(
  String.raw`(?<![\p{L}\p{N}]|как\s+${purchaseQualifiers})(?:можно(?:\s+ли)?|доступно\s+ли|можете\s+ли)\s+${purchaseQualifiers}(?:купить|оформить|заказать)(?!\p{L})`,
  "iu",
);
const componentQuestion = /что\s+(?:относится\s+к|входит\s+в)\s+[^.!?\n:;]{1,120}?,?\s+а\s+что\s+(?:[кв]\s|(?:ид[её]т|покупается)\s+отдельно)/iu;

function publicOffer({ id, name, url, price, currency, availableInCatalog, maxUsers, licenseOperation, parameters }: Offer) {
  const priceUnit = catalogPriceUnit(name);
  return { id, name, url, price, currency, priceUnit, availableInCatalog, maxUsers, licenseOperation,
    quantityBounds: priceUnit ? quantityBounds(parameters) : undefined };
}

function forBrowser(chunk: UIMessageChunk, verifiedOffers: readonly Offer[], previousOfferIds: readonly string[]): UIMessageChunk {
  if (chunk.type !== "tool-output-available" || !chunk.output || typeof chunk.output !== "object") return chunk;
  const output = chunk.output;
  if ("offers" in output && Array.isArray(output.offers)) {
    const documentQuantity = "documentQuantity" in output ? output.documentQuantity : undefined;
    return { ...chunk, output: { offers: (output.offers as Offer[]).map(publicOffer), documentQuantity } };
  }
  if ("candidates" in output && Array.isArray(output.candidates)) {
    const candidates = output.candidates.map(({ id, verdict }: { id: string; verdict: string }) => ({ id, verdict }));
    const offers = verifiedOffers.filter(offer => previousOfferIds.includes(offer.id)).map(publicOffer);
    return { ...chunk, output: { candidates, ...(offers.length ? { offers } : {}) } };
  }
  return chunk;
}

export async function POST(request: Request) {
  const apiKey = process.env.POLZA_API_KEY;
  if (!apiKey) return new Response("Сервис подбора пока не настроен.", { status: 503 });
  if (!existsSync(catalogPath)) return new Response("Каталог ещё не загружен.", { status: 503 });
  const reader = request.body?.pipeThrough(new TextDecoderStream()).getReader();
  let body = "";
  let payload: unknown;
  try {
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      if (body.length + value.length > 192_000) {
        void reader.cancel().catch(() => {});
        return new Response("Диалог слишком большой.", { status: 413 });
      }
      body += value;
    }
    payload = JSON.parse(body);
  } catch {
    return new Response("Не удалось прочитать диалог.", { status: 400 });
  } finally {
    reader?.releaseLock();
  }
  const parsed = chatBody.safeParse(payload);
  if (!parsed.success) return new Response("Не удалось прочитать диалог.", { status: 400 });

  const { messages } = parsed.data;
  const latest = messages.at(-1);
  if (latest?.role !== "user" || !latest.parts.some(part => part.text.trim())) {
    return new Response("Введите вопрос или опишите задачу.", { status: 400 });
  }
  const latestText = latest.parts.map(part => part.text).join("\n");
  const asksAvailability = availabilityQuestion.test(latestText)
    && /\b[a-z][a-z0-9-]{2,}\b/i.test(latestText);
  const asksAboutComponents = componentQuestion.test(latestText);
  let remaining = 6000;
  const turns: string[] = [];
  for (const message of messages.toReversed()) {
    const label = message.role === "user" ? "Покупатель: " : "Помощник: ";
    const limit = remaining - label.length - 1;
    if (limit <= 0) break;
    const content = message.parts.map(part => part.text).join("\n").slice(-limit);
    turns.unshift(label + content);
    remaining -= label.length + content.length + 1;
  }
  const requirements = turns.join("\n");
  const previousOfferIds = [...new Set(parsed.data.previousOfferIds)];
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  try {
    const { mastra, needsExpansionDetails, catalogReplyInstructions, catalogGroups, catalogAssessment, catalogConstraintReply, catalogGap, answerNotes, verifiedOffers } =
      createSupport(apiKey, requirements, signal, previousOfferIds);
    const stream = await handleChatStream({
      mastra,
      agentId,
      version: "v7",
      sendReasoning: false,
      onError: () => "Не удалось закончить подбор. Попробуйте ещё раз.",
      params: {
        messages, maxSteps: 4, abortSignal: signal,
        stopWhen: () => Boolean(catalogGroups() || catalogConstraintReply()),
        modelSettings: { timeout: { stepMs: 18_000, totalMs: 36_000 } },
        prepareStep: ({ stepNumber, systemMessages }) => {
          if (stepNumber === 0 && needsExpansionDetails) return {
            activeTools: [],
            toolChoice: "none",
            systemMessages: [...systemMessages, {
              role: "system",
              content: "Это расширение действующей подписки без идентификатора текущей поставки. Поясни, почему отдельная покупка дополнительного количества сама по себе не подтверждает расширение. Уточни артикул или редакцию текущей подписки и дату её окончания. Сохрани названное клиентом дополнительное количество. Не делай выводов о наличии, цене или составе каталога без поиска.",
            }],
          };
          if (stepNumber === 0 && asksAvailability) return {
            activeTools: asksAboutComponents ? ["searchCatalog", "findOffer"] : ["searchCatalog", "findOffer", "searchCatalogBatch"],
            toolChoice: "required",
          };
          const replyInstructions = catalogReplyInstructions();
          const groundedMessages = replyInstructions
            ? [...systemMessages, { role: "system" as const, content: replyInstructions }]
            : systemMessages;
          const checked = catalogAssessment();
          if (checked || stepNumber === 3) return {
            activeTools: [],
            toolChoice: "none",
            systemMessages: [...groundedMessages, {
              role: "system",
              content: [
                "Сейчас дай итог по полученным данным. У неподтверждённого варианта назови недостающий факт или отличие. Не обещай продолжить поиск.",
                checked && `Подтверждённые по условиям артикулы: ${checked.filter(candidate => candidate.verdict === "fit").map(candidate => candidate.id).join(", ") || "нет"}. Карточки уже отображают индивидуальную оценку. Запрещено писать, что проверка подтвердила весь список или позиции вне перечисленных ID. Другие варианты только справочные, явно обозначь что по ним неизвестно.`,
              ].filter(Boolean).join("\n"),
            }],
          };
          if (stepNumber === 2) return { activeTools: ["verifyFit", "findOffer", "prepareDocuments"], systemMessages: groundedMessages };
          if (asksAboutComponents) return { activeTools: ["searchCatalog", "discoverCatalog", "findOffer", "verifyFit"], systemMessages: groundedMessages };
          if (replyInstructions) return { systemMessages: groundedMessages };
        },
      },
    });
    let hasAnswer = false;
    let hasError = false;
    let catalogResult = false;
    let answerAfterResult = "";
    let verifiedFit = false;
    let constrainedAnswer: string | undefined;
    const toolsUsed = new Set<string>();
    let finished = false;
    return createUIMessageStreamResponse({ stream: stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === "tool-input-available") toolsUsed.add(chunk.toolName);
        if (chunk.type === "finish") {
          if ((catalogGroups() || catalogConstraintReply()) && chunk.finishReason === "tool-calls") {
            chunk = { ...chunk, finishReason: "stop" };
          }
          finished = chunk.finishReason === "stop";
        }
        if (constrainedAnswer && (chunk.type === "text-start" || chunk.type === "text-delta" || chunk.type === "text-end")) return;
        if (chunk.type === "text-delta") {
          hasAnswer ||= Boolean(chunk.delta.trim());
          answerAfterResult += chunk.delta;
        }
        if (chunk.type === "tool-output-available" && chunk.output && typeof chunk.output === "object") {
          if ("offers" in chunk.output || "candidates" in chunk.output || "groups" in chunk.output) {
            catalogResult = true;
            answerAfterResult = "";
          }
          if ("candidates" in chunk.output && Array.isArray(chunk.output.candidates)) {
            verifiedFit ||= chunk.output.candidates.some(candidate => candidate.verdict === "fit");
          }
          if ("offers" in chunk.output || "candidates" in chunk.output) constrainedAnswer ??= catalogConstraintReply();
          if ("groups" in chunk.output && Array.isArray(chunk.output.groups)) {
            const groups = catalogGroups();
            if (groups) constrainedAnswer = summarizeCatalogGroups(groups);
          }
        }
        if (chunk.type === "error") hasError = true;
        if (chunk.type === "finish" && !hasError && !request.signal.aborted) {
          // A tool-only turn still has a catalog outcome, even if the model stopped without prose.
          const outcome = catalogResult ? (constrainedAnswer ?? (verifiedFit ? undefined : catalogGap(answerAfterResult.trim()))
            ?? (answerAfterResult.trim() ? ""
            : verifiedFit ? "Подходящие по проверенным условиям позиции отмечены в выдаче."
            : "В каталоге не удалось подтвердить подходящую позицию по заданным условиям.")) : undefined;
          const delta = [outcome, ...answerNotes(answerAfterResult)].filter(Boolean).join("\n\n");
          if (delta) {
            const id = "catalog-outcome";
            controller.enqueue({ type: "text-start", id });
            controller.enqueue({ type: "text-delta", id, delta });
            controller.enqueue({ type: "text-end", id });
            hasAnswer = true;
          }
        }
        controller.enqueue(forBrowser(chunk, verifiedOffers(), previousOfferIds));
      },
      flush(controller) {
        try {
          const complete = finished && hasAnswer && !hasError && !request.signal.aborted;
          recordConsultation([...toolsUsed], complete ? verifiedOffers() : [], complete);
        } catch {
          console.warn("Не удалось записать результат консультации.");
        }
        if (!hasAnswer && !hasError && !request.signal.aborted) {
          controller.enqueue({ type: "error", errorText: "Подбор не завершился. Попробуйте ещё раз." });
        }
      },
    })) });
  } catch {
    return new Response("Не удалось запустить подбор. Попробуйте ещё раз.", { status: 502 });
  }
}
