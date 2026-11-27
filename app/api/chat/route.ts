import { existsSync } from "node:fs";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import { z } from "zod";
import { articleQuantityBounds, catalogPath, quantityBounds, type Offer } from "../../../lib/catalog.ts";
import { prepareCommerceDocument } from "../../../lib/commerce-documents.ts";
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
const documentQuestion = /(?<!\p{L})(?:кп|коммерческ\p{L}*\s+предложени\p{L}*|проект\s+сч[её]та|(?:подготов\p{L}*|выстав\p{L}*|оформ\p{L}*)\s+сч[её]т)(?!\p{L})/iu;
const storeReference = /(?:на|с)\s+(?:самом\s+)?(?:сайт|витрин)|актуальн\p{L}*\s+карточк|карточк\p{L}*\s+(?:магазина|на\s+сайте)|store\.softline\.ru/iu;
const snapshotReference = /фид|снимок|снимк|выгрузк|исходн\p{L}*\s+каталог|(?:ваш\p{L}*\s+каталог|в\s+(?:этом|вашем)\s+чате|вы\s+(?:указали|показали|назвали))/iu;
const priceOnRequest = /запросить\s+цену|цен[ау]\s+по\s+запросу|(?:цену|цен[аы])\s+(?:не\s+(?:указ|показыва)|скрыт)|нет\s+цены/iu;
const priceDifference = /расхожд|расходя|не\s+совпада|отлича|(?:другая|иная|новая|выше|ниже|другая\s+сумма)\s+(?:цен|стоимост)|цен[аыу]\s+(?:другая|иная|выше|ниже)/iu;
const positionIds = (text: string): string[] =>
  text.match(/(?<![\p{L}\p{N}-])\d{4,16}(?![\p{L}\p{N}-]|\s*(?:₽|руб))/giu) ?? [];

function reportsPriceConflict(text: string) {
  if (!storeReference.test(text) || !/(?:цен|стоимост|₽|рубл)/iu.test(text)) return false;
  if (!snapshotReference.test(text)) return false;
  if (priceDifference.test(text) || priceOnRequest.test(text)) return true;
  const amounts = [...text.matchAll(/(?<!\d)(\d+(?:[\p{Zs}]\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб\p{L}*)/giu)]
    .map(([, amount]) => Number(amount.replace(/\p{Zs}/gu, "").replace(",", ".")));
  return new Set(amounts).size > 1;
}

const priceConflictReply = "Вы указали расхождение между ценой на витрине и данными снимка. Для актуальной цены приоритет у витрины магазина. До подтверждения цены демо-КП и проект счёта недоступны. Нажмите «Передать менеджеру» или свяжитесь с [менеджером магазина](https://store.softline.ru/contacts/).";

function verifiedDocumentReply([offer, other]: readonly Offer[]) {
  if (!offer || other || catalogPriceUnit(offer.name)) return;
  const pricing = prepareCommerceDocument(offer, 1);
  if ("error" in pricing) return;
  const price = (pricing.amount.totalKopecks / 100).toLocaleString("ru-RU");
  const name = offer.name.replace(/[\r\n*\[\]<>]/g, " ");
  return `Подтверждена позиция ${offer.id} — ${name}, ${price} ₽ за одну позицию по каталогу. Для демо-документов откройте «Демо-КП и счёт» в карточке. Для одной позиции укажите количество 1.${offer.availableInCatalog ? "" : " Фактическую поставку подтверждает менеджер."}`;
}

function publicOffer({ id, name, url, price, currency, availableInCatalog, maxUsers, licenseOperation, article, parameters }: Offer) {
  const priceUnit = catalogPriceUnit(name);
  const terms = parameters["Срок действия"]?.filter(term => term.trim() && !/^не (?:определено|указан[оа]?)$/iu.test(term.trim()));
  const licenseTerm = terms?.length === 1 ? terms[0] : undefined;
  return { id, name, url, price, currency, priceUnit, availableInCatalog, maxUsers, licenseOperation, licenseTerm,
    quantityBounds: articleQuantityBounds(article) ?? quantityBounds(parameters) };
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
  const priorBuyer = messages.slice(0, -1).filter(message => message.role === "user")
    .map(message => message.parts.map(part => part.text).join("\n"));
  const asksAvailability = availabilityQuestion.test(latestText)
    && /\b[a-z][a-z0-9-]{2,}\b/i.test(latestText);
  const asksAboutComponents = componentQuestion.test(latestText);
  const asksForDocuments = documentQuestion.test(latestText);
  const latestIds = positionIds(latestText);
  const samePosition = /(?:вс[её]\s+равно|вс[её][-\s]+таки|тогда|(?:для|на|по)\s+эт\p{L}*\s+(?:позици|товар|лицензи)|то\s+же)(?!\p{L})/iu;
  const standaloneDocumentRequest = /^(?:дайте|сделайте|подготовьте|выставьте|оформите)\s+(?:демо[-\s]+)?(?:кп|сч[её]т|проект\s+сч[её]та)[.!?]*$/iu;
  const reportsSamePriceConflict = latestIds.length > 0
    ? priorBuyer.some(text => reportsPriceConflict(text) && positionIds(text).some(id => latestIds.includes(id)))
    : (samePosition.test(latestText) || standaloneDocumentRequest.test(latestText.trim()))
      && reportsPriceConflict(priorBuyer.at(-1) ?? "");
  if (reportsPriceConflict(latestText) || (asksForDocuments && reportsSamePriceConflict)) {
    try {
      recordConsultation([], [], true);
    } catch {
      console.warn("Не удалось записать результат консультации.");
    }
    return createUIMessageStreamResponse({ stream: createUIMessageStream({
      execute({ writer }) {
        const id = "price-conflict";
        writer.write({ type: "start" });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: priceConflictReply });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    }) });
  }
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
    const { mastra, needsExpansionDetails, needsEngineeringDetails, conferenceClarification, catalogReplyInstructions, catalogGroups, catalogAssessment, catalogConstraintReply, catalogGap, answerNotes, verifiedOffers } =
      createSupport(apiKey, requirements, signal, previousOfferIds);
    const clarification = needsExpansionDetails
      ? "Это расширение действующей подписки без идентификатора текущей поставки. Поясни, почему отдельная покупка дополнительного количества сама по себе не подтверждает расширение. Уточни артикул или редакцию текущей подписки и дату её окончания. Сохрани названное клиентом дополнительное количество. Не делай выводов о наличии, цене или составе каталога без поиска."
      : needsEngineeringDetails
        ? "Назови управление версиями документации и составом изделия (PDM/PLM) как направление подбора. Уточни, в какой САПР работает покупатель, есть ли у него PLM/PDM, какая именно и сколько рабочих мест нужно подключить. Не предполагай конкретный продукт, учебную редакцию или обновление до уточнения."
        : conferenceClarification;
    const stream = await handleChatStream({
      mastra,
      agentId,
      version: "v7",
      sendReasoning: false,
      onError: () => "Не удалось закончить подбор. Попробуйте ещё раз.",
      params: {
        messages, maxSteps: 4, abortSignal: signal,
        stopWhen: () => Boolean(catalogGroups() || catalogConstraintReply()),
        modelSettings: { maxOutputTokens: 2048, timeout: { stepMs: 18_000, totalMs: 36_000 } },
        prepareStep: ({ stepNumber, systemMessages }) => {
          if (stepNumber === 0 && clarification) return {
            activeTools: [],
            toolChoice: "none",
            systemMessages: [...systemMessages, {
              role: "system",
              content: clarification,
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
                checked && (verifiedOffers().some(offer => offer.price !== null && offer.price > 0 && /^(?:RUB|RUR)$/u.test(offer.currency))
                  ? asksForDocuments && "Если есть одна подходящая позиция с ценой в рублях, назови её, цену с единицей тарификации и как открыть демо-документы в карточке. Число мест внутри комплекта не является числом комплектов."
                  : "В проверенной выдаче нет подходящей позиции с подтверждённой ценой в рублях. Если нужны КП или счёт, предложи уточнить цену у менеджера. Кнопку скачивания не обещай."),
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
          const documentReply = verifiedFit && asksForDocuments && !constrainedAnswer
            && !/демо-кп\s+и\s+сч[её]т/iu.test(answerAfterResult)
            ? verifiedDocumentReply(verifiedOffers()) : undefined;
          // A tool-only turn still has a catalog outcome, even if the model stopped without prose.
          const outcome = catalogResult ? (constrainedAnswer ?? (verifiedFit ? undefined : catalogGap(answerAfterResult.trim()))
            ?? (answerAfterResult.trim() || documentReply ? ""
            : verifiedFit ? "Подходящие по проверенным условиям позиции отмечены в выдаче."
            : "В каталоге не удалось подтвердить подходящую позицию по заданным условиям.")) : undefined;
          const delta = [outcome, documentReply, ...answerNotes(answerAfterResult)].filter(Boolean).join("\n\n");
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
