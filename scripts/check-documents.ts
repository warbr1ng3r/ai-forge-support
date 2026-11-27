import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "t06-document-check-"));
const originalPath = process.env.SUPPORT_DB;
process.env.SUPPORT_DB = join(temp, "support.sqlite");
try {
  const { POST } = await import("../app/api/documents/route.ts");
  const { knowledgeOverview } = await import("../lib/knowledge.ts");

  const quote = { type: "quote", offerId: "19579", quantity: 2, buyer: "ООО <script>Демо</script>", buyerInn: "7700000000" };
  const request = (data: unknown) => POST(new Request("http://localhost/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }));
  const documentText = async (response: Response) => (await response.text()).replace(/\p{Zs}/gu, " ");

  const proposal = await request({ ...quote, price: 1, total: 2, article: "client-article" });
  assert.equal(proposal.status, 200);
  assert.match(proposal.headers.get("Content-Type") ?? "", /text\/html/);
  assert.equal(proposal.headers.get("Content-Disposition"), 'attachment; filename="quote-19579.html"');
  assert.equal(proposal.headers.get("Cache-Control"), "no-store");
  const proposalHtml = await documentText(proposal);
  assert.match(proposalHtml, /<title>Коммерческое предложение<\/title>/u);
  assert.match(proposalHtml, /Демо-документ\. Для согласования\. Не для оплаты\./u);
  assert.match(proposalHtml, /101 171,00 ₽/u);
  assert.match(proposalHtml, /202 342,00 ₽/u);
  assert.match(proposalHtml, /пакет до 50 пользователей/u);
  assert.match(proposalHtml, /ООО &lt;script&gt;Демо&lt;\/script&gt;/u);
  assert.match(proposalHtml, /7700000000/u);
  assert.match(proposalHtml, /Срок действия предложения/u);
  assert.doesNotMatch(proposalHtml, /<script>|client-article|Проект счёта на оплату/iu);

  const invoice = await request({ type: "invoice", offerId: "222182", quantity: 65, buyer: "ООО Демо" });
  assert.equal(invoice.status, 200);
  assert.equal(invoice.headers.get("Content-Disposition"), 'attachment; filename="invoice-222182.html"');
  const invoiceHtml = await documentText(invoice);
  assert.match(invoiceHtml, /<title>Проект счёта на оплату<\/title>/u);
  assert.match(invoiceHtml, /рабочая станция \/ файловый сервер/u);
  assert.match(invoiceHtml, /1 896,30 ₽/u);
  assert.match(invoiceHtml, /123 259,50 ₽/u);
  assert.match(invoiceHtml, /Банковские реквизиты<\/dt><dd>Не указаны/u);
  assert.match(invoiceHtml, /НДС<\/dt><dd>Ставка и сумма не подтверждены/u);
  assert.match(invoiceHtml, /Итог к оплате<\/dt><dd>Не согласован/u);

  for (const type of ["quote", "invoice"]) {
    const unavailable = await request({ ...quote, type, offerId: "125279", quantity: 1 });
    assert.equal(unavailable.status, 200, type);
    assert.equal(unavailable.headers.get("Content-Disposition"), `attachment; filename="${type}-125279.html"`);
    const html = await documentText(unavailable);
    assert.match(html, /3 904,00 ₽/u);
    assert.match(html, /Фактическую поставку подтверждает менеджер\./u);
    assert.match(html, /Демо-документ\. Для согласования\. Не для оплаты\./u);

    const stale = await request({ ...quote, type, offerId: "100599", quantity: 1 });
    assert.equal(stale.status, 422, type);
    assert.equal(stale.headers.get("Content-Disposition"), null);
    assert.match(await stale.text(), /Обратитесь к менеджеру магазина/u);
  }

  for (const offerId of ["100599", "48094", "365609", "477554", "222179"]) {
    const rejected = await request({ ...quote, offerId, quantity: 65 });
    assert.equal(rejected.status, 422, offerId);
    assert.equal(rejected.headers.get("Content-Disposition"), null, offerId);
  }
  assert.equal((await request({ ...quote, offerId: "3582", quantity: 100 })).status, 422);
  const ipQuote = await request({ ...quote, offerId: "143402", quantity: 10 });
  assert.equal(ipQuote.status, 200);
  assert.match(await documentText(ipQuote), /43 500,00 ₽/u);
  assert.equal((await request({ ...quote, offerId: "143402", quantity: 9 })).status, 422);
  assert.equal((await request({ ...quote, offerId: "3850", quantity: 49 })).status, 422);

  const smallCadQuote = await request({ ...quote, offerId: "532976", quantity: 4 });
  assert.equal(smallCadQuote.status, 200);
  assert.match(await documentText(smallCadQuote), /191 600,00 ₽/u);
  const largeCadInvoice = await request({ ...quote, type: "invoice", offerId: "532973", quantity: 12 });
  assert.equal(largeCadInvoice.status, 200);
  assert.match(await documentText(largeCadInvoice), /514 800,00 ₽/u);
  for (const [offerId, quantity] of [["532973", 4], ["532976", 12]] as const) {
    const wrongTier = await request({ ...quote, offerId, quantity });
    assert.equal(wrongTier.status, 422, offerId);
    assert.equal(wrongTier.headers.get("Content-Disposition"), null, offerId);
    assert.match(await wrongTier.text(), /Количество выходит за пределы тарифа/u);
  }

  const ambiguousBundle = await request({ ...quote, offerId: "542049", quantity: 1 });
  assert.equal(ambiguousBundle.status, 422);
  assert.match(await ambiguousBundle.text(), /Единицу цены комплекта уточните/);
  assert.equal((await request({ ...quote, offerId: "9999999999999999" })).status, 404);
  for (const input of [{ quantity: 0 }, { quantity: 1.5 }, { buyer: "   " }, { buyerInn: "123" }]) {
    assert.equal((await request({ ...quote, ...input })).status, 400);
  }
  assert.equal((await request({ ...quote, buyer: "x".repeat(4200) })).status, 413);

  const events = knowledgeOverview().events.map(({ action, details }) => ({ action, details: JSON.parse(details) }));
  assert.deepEqual(events.toReversed(), [
    { action: "Сформировано КП", details: { offerId: "19579", count: 2 } },
    { action: "Сформирован проект счёта", details: { offerId: "222182", count: 65 } },
    { action: "Сформировано КП", details: { offerId: "125279", count: 1 } },
    { action: "Сформирован проект счёта", details: { offerId: "125279", count: 1 } },
    { action: "Сформировано КП", details: { offerId: "143402", count: 10 } },
    { action: "Сформировано КП", details: { offerId: "532976", count: 4 } },
    { action: "Сформирован проект счёта", details: { offerId: "532973", count: 12 } },
  ]);

  console.log("Document and event checks passed on the real catalogue snapshot.");
} finally {
  if (originalPath === undefined) delete process.env.SUPPORT_DB;
  else process.env.SUPPORT_DB = originalPath;
  rmSync(temp, { recursive: true, force: true });
}
