import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { POST } from "../app/api/knowledge/route.ts";
import { openCatalog } from "../lib/catalog.ts";
import { knowledgeEntry, knowledgeOverview, lookupKnowledge, recordConsultation } from "../lib/knowledge.ts";
import { managerCookieName, signInManager } from "../lib/manager-auth.ts";

const directory = mkdtempSync(join(tmpdir(), "support-knowledge-"));
process.env.SUPPORT_DB = join(directory, "support.sqlite");
process.env.MANAGER_ACCESS_TOKEN = "test-manager-token";
const catalog = openCatalog();
const article = {
  title: "Оплата лицензии",
  keywords: "Правила-оплаты, сроки оплаты",
  fact: "Физическое лицо может оплатить картой доступный для него товар.",
  source: "https://store.softline.ru/delivery_info/",
};
const post = (cookie?: string, origin?: string, accept?: string, fields = article) => POST(new Request("http://localhost/api/knowledge", {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    ...(cookie ? { Cookie: `${managerCookieName}=${cookie}` } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...(accept ? { Accept: accept } : {}),
  },
  body: new URLSearchParams(fields),
}));

try {
  const [offer] = catalog.find("197958");
  assert.ok(offer);
  recordConsultation(["findOffer", "verifyFit"], [offer], true);
  recordConsultation(["findOffer", "verifyFit"], [offer], true);
  assert.equal(lookupKnowledge("Подскажите условия позиции №197958.").length, 1);
  assert.equal(lookupKnowledge("Позиция 1979580").length, 0);
  assert.doesNotMatch(lookupKnowledge("SKU 197958")[0].fact, /70\s*000|₽/);
  const certificateFacts = lookupKnowledge("Останутся ли деньги на подарочном сертификате и можно ли оплатить им доставку?");
  assert.equal(certificateFacts[0]?.source, "https://store.softline.ru/delivery_info/");
  assert.match(certificateFacts[0]?.fact ?? "", /одного заказа.*1%.*остаток.*доставку/);
  assert.match(lookupKnowledge("Купил программу в Softline. Куда обратиться за технической поддержкой?")[0]?.fact ?? "",
    /бесплатно в течение трёх месяцев.*store\.support@softline\.com.*9:00 до 18:00/);
  assert.match(lookupKnowledge("Можно передумать и вернуть коробочную лицензию?")[0]?.fact ?? "", /семи дней/);
  const damagedShipment = lookupKnowledge("У перевозчика при выдаче коробка разбита и обнаружилась недостача. Кому и когда отправить акт?")[0];
  assert.equal(damagedShipment?.id, "store:regional-carrier-claims");
  assert.match(damagedShipment.fact, /сотрудники перевозчика.*коммерческий акт.*фотографии.*1–2 дня.*sales\.r@softline\.com.*менеджеру.*двух рабочих дней/);
  const pickupDocuments = lookupKnowledge("Представитель ИП будет забирать заказ, какие документы ему предъявить?")[0];
  assert.equal(pickupDocuments?.id, "store:pickup-documents");
  assert.match(pickupDocuments.fact, /оригинал доверенности формы М2.*паспорт получателя.*копия свидетельства о регистрации ИП.*копия паспорта ИП/);
  const paperDocuments = lookupKnowledge("После отправки ключа когда пришлют бумажные закрывающие документы? Коробку везёт курьер.")[0];
  assert.equal(paperDocuments?.id, "store:paper-accounting-documents");
  assert.match(paperDocuments.fact, /Почтой России.*семи рабочих дней после отправки ключа.*срок доставки зависит.*вместе с заказом/);
  assert.ok(!lookupKnowledge("Где скачать закрывающие документы в личном кабинете?").some(fact => fact.id === "store:paper-accounting-documents"));
  assert.equal(lookupKnowledge("Нужен сертификат ФСТЭК и техподдержка на год для Astra Linux").length, 0);
  assert.equal(knowledgeEntry.safeParse({ ...article, source: "javascript:alert(1)" }).success, false);
  assert.equal(knowledgeEntry.safeParse({ ...article, keywords: "..." }).success, false);
  assert.equal((await post()).status, 403);
  const session = signInManager("test-manager-token");
  assert.ok(session);
  assert.equal((await post(session, "https://external.test")).status, 403);
  assert.equal((await post(session, "http://localhost")).headers.get("Location"), "/manager/knowledge?status=published");
  const [fact] = lookupKnowledge("Где посмотреть Правила оплаты?");
  assert.equal(fact.fact, article.fact);
  assert.equal(fact.source, article.source);
  assert.equal(knowledgeOverview().events.filter(event => event.action === "Опубликована статья").length, 1);

  const json = "application/json";
  const denied = await post(undefined, undefined, json);
  assert.equal(denied.status, 403);
  assert.equal(typeof (await denied.json()).error, "string");
  const invalid = await post(session, "http://localhost", json, { ...article, fact: "" });
  assert.equal(invalid.status, 422);
  assert.equal(typeof (await invalid.json()).error, "string");

  const second = { ...article, title: "Проверка повторной публикации", keywords: "повторная публикация" };
  const database = new DatabaseSync(process.env.SUPPORT_DB);
  try {
    database.exec(`CREATE TRIGGER fail_publication_log BEFORE INSERT ON support_events
      WHEN NEW.action = 'Опубликована статья' BEGIN SELECT RAISE(ABORT, 'test log failure'); END;`);
    const failure = await post(session, "http://localhost", json, second);
    assert.equal(failure.status, 503);
    const failureBody = await failure.json();
    assert.equal(typeof failureBody.error, "string");
    assert.doesNotMatch(failureBody.error, /test log failure/);
    const legacyFailure = await post(session, "http://localhost", undefined, second);
    assert.equal(legacyFailure.status, 503);
    assert.equal(lookupKnowledge("повторная публикация").length, 0);
    assert.equal(knowledgeOverview().events.filter(event => event.action === "Опубликована статья").length, 1);
    database.exec("DROP TRIGGER fail_publication_log");

    const submitted = await post(session, "http://localhost", json, second);
    assert.equal(submitted.status, 201);
    const published = await submitted.json();
    assert.equal(lookupKnowledge("повторная публикация").length, 1);
    assert.equal(lookupKnowledge("повторная публикация")[0].id, published.id);
    assert.deepEqual(JSON.parse(knowledgeOverview().events[0].details), { id: published.id });
  } finally {
    database.close();
  }
  console.log("Knowledge checks passed: ingestion, manager access, validation, atomic publication and reuse.");
} finally {
  catalog.close();
  rmSync(directory, { recursive: true, force: true });
}
