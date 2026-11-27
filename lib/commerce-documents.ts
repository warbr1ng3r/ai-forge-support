import { z } from "zod";
import { coversQuantityTier, normalizeSearch, openCatalog, quantityTierParameter, rubleTotals, type Offer } from "./catalog.ts";
import { catalogPriceUnit } from "./store-faq.ts";

export const commerceDocumentRequest = z.object({
  type: z.enum(["quote", "invoice"]),
  offerId: z.string().regex(/^\d{1,16}$/u),
  quantity: z.number().int().positive(),
  buyer: z.string().trim().min(1).max(160),
  buyerInn: z.string().trim().regex(/^(?:\d{10}|\d{12})$/u).optional(),
});

type DocumentRequest = z.infer<typeof commerceDocumentRequest>;

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" });
const units = {
  "узел": "узел",
  "почтовый адрес": "почтовый адрес",
  "рабочую станцию или файловый сервер": "рабочая станция / файловый сервер",
  "IP-адрес": "IP-адрес",
};

const includesBundle = /\b(?:bundle|pack|package)\b|(?<!\p{L})(?:комплект|пакет|набор)(?!\p{L})/iu;
const explicitItemPrice = /цена за (?:(?:комплект|пакет|набор)|1\s+(?:шт\.|лицензию|подписку|дистрибутив|экземпляр))(?!\p{L})/iu;

export function ambiguousBundlePrice(offer: Offer) {
  return includesBundle.test(offer.name) && !catalogPriceUnit(offer.name)
    && !explicitItemPrice.test(`${offer.name} ${offer.description}`);
}

function pricingUnit(offer: Offer, quantity: number): { label: string } | { error: string } {
  const catalogUnit = catalogPriceUnit(offer.name);
  if (catalogUnit) {
    const covers = coversQuantityTier(offer.parameters, quantity);
    if (covers === false) return { error: "Количество выходит за пределы тарифа этой позиции." };
    if (covers === undefined) return { error: "Диапазон количества по этому тарифу уточните у магазина." };
    return { label: units[catalogUnit] };
  }

  const name = normalizeSearch(offer.name);
  const description = normalizeSearch(offer.description);
  if (offer.parameters[quantityTierParameter] || offer.parameters["К-во узлов"] ||
    /(?:по количеству|по объему|(?<!\p{L})количество(?!\p{L})|\bper (?:user|seat|unit)\b)/u.test(name)) {
    return { error: "Единицу и диапазон расчёта для этой позиции уточните у магазина." };
  }

  const bounds = description.match(/(?:^| • )минимальная покупка: от ([1-9]\d*)(?: до ([1-9]\d*))? шт\.?(?=$| • )/u);
  const pricedPerItem = explicitItemPrice.test(`${name} ${description}`);
  if (ambiguousBundlePrice(offer)) {
    return { error: "Единицу цены комплекта уточните у магазина." };
  }
  if (!bounds && !pricedPerItem) {
    return { error: "В карточке не указаны условия расчёта количества. Уточните их у магазина." };
  }
  if (bounds && (quantity < Number(bounds[1]) || bounds[2] && quantity > Number(bounds[2]))) {
    return { error: "Количество выходит за пределы, указанные для этой позиции." };
  }
  return { label: offer.maxUsers && offer.maxUsers > 1 ? `пакет до ${offer.maxUsers} пользователей` : "шт. (позиция каталога)" };
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function documentHtml(request: DocumentRequest, offer: Offer, unit: string, priceKopecks: number, totalKopecks: number) {
  const isQuote = request.type === "quote";
  const title = isQuote ? "Коммерческое предложение" : "Проект счёта на оплату";
  const source = new URL(offer.url);
  const sourceMarkup = source.origin === "https://store.softline.ru" && !source.username && !source.password
    ? `<a href="${escapeHtml(source.href)}">Карточка позиции ${escapeHtml(offer.id)}</a>`
    : `Позиция каталога ${escapeHtml(offer.id)}`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; background: #fff; color: #1d2939; font: 14px/1.55 system-ui, sans-serif; }
    body { margin: 0; }
    main { box-sizing: border-box; width: min(100%, 880px); margin: auto; padding: clamp(16px, 5vw, 56px); }
    h1 { margin: 8px 0 0; font-size: clamp(24px, 5vw, 37px); line-height: 1.15; }
    h2 { margin: 24px 0 6px; font-size: 16px; }
    p { margin: 6px 0; }
    .demo { margin-bottom: 24px; padding: 9px 12px; border: 1px solid #80532b; color: #67411e; font-weight: 700; }
    .muted { color: #52616d; }
    dl { display: grid; grid-template-columns: minmax(7rem, 1fr) 2fr; gap: 4px 12px; margin: 10px 0 20px; }
    dt { color: #52616d; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .table-scroll { margin-top: 16px; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; min-width: 580px; table-layout: fixed; }
    th, td { padding: 9px 7px; border-bottom: 1px solid #cbd5e1; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    thead th { border-bottom: 2px solid #52616d; font-size: 12px; }
    .amount { text-align: right; font-variant-numeric: tabular-nums; }
    td.amount { white-space: nowrap; }
    tfoot { font-weight: 700; }
    footer { margin-top: 22px; border-top: 1px solid #cbd5e1; padding-top: 9px; }
    a { color: #1b4a9a; }
    @media (max-width: 480px) { th, td { padding: 7px 3px; font-size: 11px; } }
    @media print { @page { size: A4; margin: 16mm; } main { max-width: none; padding: 0; }
      .table-scroll { overflow: visible; } table { min-width: 0; } tr { break-inside: avoid; } }
  </style>
</head>
<body><main>
  <p class="demo">Демо-документ. Для согласования. Не для оплаты.</p>
  <header>
    <h1>${title}</h1>
    <p class="muted">Дата подготовки ${date.format(new Date())}</p>
  </header>
  ${offer.availableInCatalog ? "" : '<p>Позиция недоступна по снимку каталога. Фактическую поставку подтверждает менеджер.</p>'}
  <dl>
    <dt>Покупатель</dt><dd>${escapeHtml(request.buyer)}</dd>
    <dt>ИНН покупателя</dt><dd>${request.buyerInn ? escapeHtml(request.buyerInn) : "Не указан"}</dd>
    <dt>Поставщик</dt><dd>Требует подтверждения магазином</dd>
    ${isQuote ? "" : "<dt>Номер счёта</dt><dd>Не присвоен</dd><dt>Банковские реквизиты</dt><dd>Не указаны</dd>"}
  </dl>
  <div class="table-scroll" tabindex="0" role="region" aria-label="Позиции документа">
  <table>
    <colgroup><col style="width:15%"><col style="width:36%"><col style="width:15%"><col style="width:17%"><col style="width:17%"></colgroup>
    <thead><tr><th scope="col">Артикул</th><th scope="col">Наименование</th><th scope="col">Количество</th>
      <th scope="col" class="amount">Цена за единицу</th><th scope="col" class="amount">Сумма</th></tr></thead>
    <tbody><tr>
      <td>${offer.article ? escapeHtml(offer.article) : "Не указан"}<br><span class="muted">Позиция ${escapeHtml(offer.id)}</span></td>
      <td>${escapeHtml(offer.name)}</td>
      <td>${request.quantity}<br><span class="muted">${escapeHtml(unit)}</span></td>
      <td class="amount">${money.format(priceKopecks / 100)}</td>
      <td class="amount">${money.format(totalKopecks / 100)}</td>
    </tr></tbody>
    <tfoot><tr><th colspan="4" scope="row">Итого по каталогу</th><td class="amount">${money.format(totalKopecks / 100)}</td></tr></tfoot>
  </table>
  </div>
  <h2>Условия для согласования</h2>
  <dl>
    <dt>НДС</dt><dd>Ставка и сумма не подтверждены</dd>
    <dt>Условия оплаты</dt><dd>Требуют подтверждения магазином</dd>
    <dt>Срок поставки</dt><dd>Не согласован</dd>
    ${isQuote ? "<dt>Срок действия предложения</dt><dd>Не согласован</dd>" : "<dt>Итог к оплате</dt><dd>Не согласован</dd>"}
  </dl>
  <footer class="muted">Источник цены — снимок каталога. ${sourceMarkup}.</footer>
</main></body>
</html>`;
}

export function prepareCommerceDocument(offer: Offer, quantity: number):
  { error: string } | { unit: { label: string }; amount: { unitKopecks: number; totalKopecks: number } } {
  if (offer.price === null || offer.price <= 0) return { error: "Для этой позиции нет подтверждённой цены в каталоге." };
  if (!["RUB", "RUR"].includes(offer.currency)) return { error: "Подтверждённая цена в рублях для этой позиции отсутствует." };
  const unit = pricingUnit(offer, quantity);
  if ("error" in unit) return { error: unit.error };
  const amount = rubleTotals(offer.price, offer.currency, quantity);
  if (!amount) return { error: "Сумму для указанного количества рассчитать не удалось." };
  return { unit, amount };
}

export function createCommerceDocument(request: DocumentRequest): { filename: string; html: string } | { error: string; status: number } {
  const catalog = openCatalog();
  try {
    const offer = catalog.find(request.offerId).find(item => item.id === request.offerId);
    if (!offer) return { error: "Позиция не найдена в каталоге.", status: 404 };
    const pricing = prepareCommerceDocument(offer, request.quantity);
    if ("error" in pricing) return { error: pricing.error, status: 422 };
    return {
      filename: `${request.type}-${offer.id}.html`,
      html: documentHtml(request, offer, pricing.unit.label, pricing.amount.unitKopecks, pricing.amount.totalKopecks),
    };
  } finally {
    catalog.close();
  }
}
