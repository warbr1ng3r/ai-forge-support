import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "../app/api/chat/route.ts";

const apiKey = "local-chat-fixture";
const originalKey = process.env.POLZA_API_KEY;
const originalSupportDb = process.env.SUPPORT_DB;
const state = mkdtempSync(join(tmpdir(), "support-chat-"));
const originalFetch = globalThis.fetch;
const absentId = "9999999999999999";
let decisionCalls = 0;
let chatCalls = 0;

function stream(delta: object, finish: "stop" | "tool_calls") {
  const frame = (content: object, finishReason: string | null) => ({
    id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1,
    model: "deepseek/deepseek-v4.1-flash-1017",
    choices: [{ index: 0, delta: content, finish_reason: finishReason }],
  });
  const events = [frame({ role: "assistant", ...delta }, null), frame({}, finish)];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}

const message = (id: string, role: "user" | "assistant", text: string) =>
  ({ id, role, parts: [{ type: "text", text }] });
const messages = [
  message("1", "user", "Нужна новая лицензия MDaemon на 50 пользователей."),
  message("2", "assistant", "Пакет на 50 мест. Вы точно хотите 50?"),
  message("3", "user", "Исправление: нужно 60 мест. Этот пакет подойдёт?"),
];
const documentFollowUp = "Подготовьте черновик КП для продления на 65 рабочих станций.";
const selectedDocumentFollowUp = "На ту же подписку нужны демо-КП и проект счёта на 1 штуку. Будет ли доступ завтра?";
const installationQuestion = "Лицензия видна в аккаунте, но при установке не удалось скачать файл. Что делать?";
const promotionQuestion = "У производителя есть специальные условия для небольших компаний. Вы можете подтвердить скидку?";
const privatePurchaseQuestion = "Я самозанятый без ИП. Могу купить электронную лицензию как физлицо? Продукт ещё не выбрал.";
const renewalQuestion = "Проверьте СКАНЕР-ВС 7, позицию 486969. Это продление Enterprise на год и на 2048 активов? Какова цена в каталоге?";
const bundlePriceQuestion = "ТИМ КРЕДО на 11 рабочих мест, позиции 438375 и 542049. Это цена за весь комплект или за одно место?";
const packageQuoteQuestion = "Нужен один клиентский компонент Appius PLM для КОМПАС-3D на пять рабочих мест, позиция 499760. Подготовьте демо-КП.";
const tierRepriceQuestion = "Заказываем 12 лицензий той же редакции. Пересчитайте цену.";
const elbrusQuestion = "Нужна «Альт Рабочая станция 10» для Эльбрус-8СВ, артикул ALT10-0900W. Подтвердите цену 10 560 ₽ и наличие.";
const storePolicyChecks = [
  {
    question: "Оплатили счёт после истечения срока. Если платёж не примут, когда ждать возврата денег?",
    facts: [/на акцепт.*три рабочих дня/, /в течение трёх рабочих дней с получения платежа/, /пяти рабочих дней с даты поступления заявления/],
    omitted: /Условия возврата коробки/,
  },
  {
    question: "Как вернуть нераспакованное оборудование после получения?",
    facts: [/Условия возврата коробки/, /семи дней после получения/],
    omitted: /Акцепт заказа и поздний платёж/,
  },
  {
    question: "Как считается стоимость доставки в пределах МКАД, а как — в десяти километрах за ним?",
    facts: [/590 ₽.*30 000 ₽/, /790 ₽.*50 000 ₽/, /негабаритных и тяжеловесных/],
  },
  {
    question: "Какие банки отвечают за эквайринг и видит ли магазин реквизиты карты?",
    facts: [/защищённой странице/, /магазин не получает полные реквизиты карты/, /Сбербанк и ВТБ/],
  },
  {
    question: "Складываются ли промокод и скидка по текущей акции магазина?",
    facts: [/скидки не суммируются, если условия акции прямо не разрешают/, /срок и распространяться/, /индивидуальную скидку.*менеджером/],
  },
  {
    question: "Нужно отменить доставку фискального накопителя, я пока его не получал. Как отказаться?",
    facts: [/до получения покупатель может отказаться/, /оплаченного счёта.*причину/],
    omitted: /Условия возврата коробки/,
  },
  {
    question: "Подлежит ли возврату уже полученный исправный фискальный накопитель?",
    facts: [/надлежащего качества не подлежит обмену или возврату/, /с дефектом.*через менеджера/],
    omitted: /Условия возврата коробки/,
  },
  {
    question: "Отправляете тяжёлое оборудование в Пермь? Кто оплачивает доставку и выполняет разгрузку?",
    facts: [/2–7 рабочих дней/, /составу заказа и региону/, /Разгрузку и подъём.*силами заказчика.*менеджером/],
  },
  {
    question: "Что будет с лицензией организации, если появится правопреемник?",
    facts: [/при реорганизации с правопреемством лицензия продолжает действовать/, /при ликвидации.*теряет силу/],
    omitted: /Переоформление лицензии уволившегося сотрудника/,
  },
  {
    question: "На сотрудника оформлена лицензия. Он уволился. Можем ли потребовать её переоформить?",
    facts: [/организация не может требовать переоформления/, /согласованного переноса зависит от конкретного договора/],
    omitted: /Действие лицензии компании при правопреемстве/,
  },
];
const scopedLicenseChecks = [
  { question: "Позиция 541992 на год. Хватит ли купить восемь лицензий для восьми управляемых компьютеров и 14 сотрудников?", ids: ["541992"], answer: /одного клиента.*сотрудников.*компьютеров.*лицензируемых подключений/u },
  { question: "Локальный RuDesktop на год, позиции 487234, 518158 и 518159. Включены ли подключения в управляющий сервер?", ids: ["487234", "518158", "518159"], answer: /сервер и подключения[^\n]*не подтверждает, сколько подключений включено и требуется ли покупать их отдельно/u },
  { question: "Позиция 433270. Нужна бессрочная лицензия без физической поставки. Какой срок, способ поставки и цена подтверждены?", ids: ["433270"], answer: /Срок по карточке однозначно подтвердить нельзя.*Отсутствие физической поставки карточка не подтверждает.*срок лицензии и способ поставки/u },
  { question: "Для бессрочной лицензии хочу продлить только обновления. Выбор из 519774 и 519775. Какая цена?", ids: ["519774", "519775"], answer: /Позиция 519775.*Позиция 519774 продлевает временную лицензию/u },
  { question: "Поправка: лицензия временная. Нужно продлить на год само право использования. Что выбрать из тех же позиций?", previous: "Сравните 519774 и 519775 для продления обновлений.", ids: ["519774", "519775"], answer: /Позиция 519774.*Позиция 519775 продлевает только подписку на обновления.*карточки не подтверждают/u },
] as const;
const endpoint = "http://localhost/api/chat";
const post = (body: unknown) => POST(new Request(endpoint, { method: "POST", body: JSON.stringify(body) }));

process.env.POLZA_API_KEY = apiKey;
process.env.SUPPORT_DB = join(state, "support.sqlite");
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(request.headers.get("Authorization"), `Bearer ${apiKey}`);
  if (request.url === "https://polza.ai/api/v1/systemone") {
    decisionCalls++;
    const body = await request.json();
    assert.equal(body.model, "google/gemini-decision-1");
    const { requirements, candidates } = JSON.parse(body.state);
    if (requirements.includes(packageQuoteQuestion)) {
      assert.equal(candidates.candidate_1.id, "499760");
      return Response.json({ answers: { candidate_1: { type: "choice", choice: "fit", confidence: 1 } } });
    }
    if (requirements.includes(documentFollowUp)) {
      assert.deepEqual(Object.values(candidates).map(candidate => (candidate as { id: string }).id), ["222179", "222182"]);
      return Response.json({ answers: Object.fromEntries(Object.keys(candidates).map(key => [key, { type: "choice", choice: "fit", confidence: 1 }])) });
    }
    if (requirements.includes("Альт Виртуализация 11")) {
      assert.deepEqual(Object.values(candidates).map(candidate => (candidate as { id: string }).id), ["496948", "496952", "496967", "496968"]);
      return Response.json({ answers: Object.fromEntries(Object.keys(candidates).map(key => [key, { type: "choice", choice: "fit", confidence: 1 }])) });
    }
    if (requirements.includes("10 гостевых ВМ")) {
      assert.equal(candidates.candidate_1.id, "487938");
      return Response.json({ answers: { candidate_1: { type: "choice", choice: "fit", confidence: 1 } } });
    }
    assert.equal(requirements, messages.map(turn =>
      (turn.role === "user" ? "Покупатель: " : "Помощник: ") + turn.parts[0].text).join("\n"));
    assert.match(body.questions.candidate_1.instructions, /последнее указанное покупателем значение/);
    const { id, maxUsers, price, licenseOperation } = candidates.candidate_1;
    assert.deepEqual({ id, maxUsers, price, licenseOperation }, {
      id: "19579", maxUsers: 50, price: 101171, licenseOperation: "new",
    });
    return Response.json({ answers: { candidate_1: { type: "choice", choice: "fit", confidence: 1 } } });
  }

  assert.equal(request.url, "https://polza.ai/api/v1/chat/completions");
  chatCalls++;
  const body = await request.json() as { messages: Array<{ role: string; content: string }>; tool_choice?: string; tools?: unknown[]; max_tokens?: number };
  assert.equal(body.max_tokens, 2048, "Bound the provider's per-call balance reservation");
  const system = body.messages.filter(turn => turn.role === "system").map(turn => turn.content).join("\n");
  const storePolicy = storePolicyChecks.find(({ question }) => body.messages.some(turn => turn.role === "user" && turn.content.includes(question)));
  if (storePolicy) {
    for (const fact of storePolicy.facts) assert.match(system, fact);
    if (storePolicy.omitted) assert.doesNotMatch(system, storePolicy.omitted);
    return stream({ content: "Ответ по правилам магазина." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(installationQuestion))) {
    return stream({ content: "Уточните, какой продукт и версию устанавливаете и на какой ОС." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(documentFollowUp))) {
    if (body.messages.some(turn => turn.role === "tool")) {
      return stream({ content: "Для подходящей позиции можно скачать черновик КП." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_verify_document", type: "function",
      function: { name: "verifyFit", arguments: '{"ids":["222182","222179"]}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("банковским переводом"))) {
    assert.match(system, /Юрлица и ИП могут платить банковским переводом/);
    assert.match(system, /https:\/\/store\.softline\.ru\/delivery_info\//);
    return stream({ content: "Да, магазин принимает банковский перевод от юрлиц и ИП." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(promotionQuestion))) {
    return stream({ content: "Уточните, пожалуйста, продукт и редакцию." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(privatePurchaseQuestion))) {
    assert.match(system, /часть лицензий предназначена только для организаций/iu);
    assert.match(system, /запроси название или артикул/iu);
    return stream({ content: "Купить как физлицо можно, если условия позиции это допускают. Уточните название или артикул." }, "stop");
  }
  const tool = body.messages.findLast(turn => turn.role === "tool");
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(tierRepriceQuestion))) {
    assert.equal(tool, undefined, "Repricing a known tier should finish after the first catalog step");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_tier_search_with_seat_filter", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"GstarCAD 2027 LT локальная постоянная","users":12,"operation":"new"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(packageQuoteQuestion))) {
    if (tool && JSON.parse(tool.content).candidates) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: tool ? "fixture_check_package" : "fixture_find_package", type: "function",
      function: tool
        ? { name: "verifyFit", arguments: '{"ids":["499760"]}' }
        : { name: "findOffer", arguments: '{"id":"499760"}' },
    }] }, "tool_calls");
  }
  const licenseCheck = scopedLicenseChecks.find(({ question }) => body.messages.some(turn => turn.role === "user" && turn.content.includes(question)));
  if (licenseCheck) {
    assert.equal(tool, undefined, "Exact catalogue evidence should produce a grounded answer without another model step");
    return stream({ tool_calls: licenseCheck.ids.map((id, index) => ({
      index, id: `fixture_license_${id}`, type: "function",
      function: { name: "findOffer", arguments: JSON.stringify({ id }) },
    })) }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(bundlePriceQuestion))) {
    assert.equal(tool, undefined, "Bundle price must resolve from the catalogue without an inferred unit");
    return stream({ tool_calls: ["438375", "542049"].map((id, index) => ({
      index, id: `fixture_bundle_price_${id}`, type: "function",
      function: { name: "findOffer", arguments: JSON.stringify({ id }) },
    })) }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(renewalQuestion))) {
    if (tool) {
      const [offer] = JSON.parse(tool.content).offers;
      assert.equal(offer.id, "486969");
      assert.equal(offer.licenseOperation, "renewal");
      assert.match(offer.description, /тип операции сам по себе не подтверждает требования к действующему сроку/iu);
      assert.match(offer.description, /отметка с номером не подтверждает региональных ограничений/iu);
      assert.match(system, /у основной лицензии и её продления могут быть разные артикулы/iu);
      assert.match(system, /Исключи советы сверять совпадение артикулов/iu);
      assert.match(system, /условия допуска к продлению.*только по карточке или правилам производителя/iu);
      return stream({ content: "Это продление Enterprise на 12 месяцев для 2048 активов за 966 000 ₽." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_scanner_renewal", type: "function",
      function: { name: "findOffer", arguments: '{"id":"486969"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("будет 20 узлов"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_changed_node_tier", type: "function",
      function: { name: "findOffer", arguments: '{"id":"4984"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes(selectedDocumentFollowUp))) {
    return stream({ tool_calls: [{
      index: 0, id: "fixture_prepare_documents", type: "function",
      function: { name: "prepareDocuments", arguments: '{"id":"41159","quantity":1}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("академическая цена"))) {
    return stream({ content: "Академическая цена зависит от продукта и программы.", }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("Альт Виртуализация 11"))) {
    if (tool && JSON.parse(tool.content).candidates) return stream({ content: "Сравнил четыре позиции по редакции и сроку." }, "stop");
    return stream({ tool_calls: [{
      index: 0, id: tool ? "fixture_alt_fit" : "fixture_alt_search", type: "function",
      function: tool
        ? { name: "verifyFit", arguments: '{"ids":["496948","496952","496967","496968"]}' }
        : { name: "searchCatalog", arguments: '{"query":"Альт Виртуализация 11"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("до 10 виртуальных машин"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_astra_guest_search", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"Astra Linux Воронеж сервер"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("ContentReader PDF 16") && turn.content.includes("300 одновременных"))) {
    if (tool) return stream({ content: "Ориентировочная стоимость 5 921 700 ₽." }, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_concurrent_license", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"ContentReader PDF 16 Concurrent"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("КриптоАРМ ГОСТ"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_cryptoarm_seat", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"КриптоАРМ ГОСТ","users":1}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("ALT10-0900W"))) {
    if (tool) {
      if (body.messages.some(turn => turn.role === "user" && turn.content.includes(elbrusQuestion))) {
        return stream({ content: "ARMv8 совместима с Эльбрус-8СВ." }, "stop");
      }
      const offers = JSON.parse(tool.content).offers;
      if (body.messages.some(turn => turn.role === "user" && turn.content.includes("похожие позиции")) && !offers.length) {
        return stream({ tool_calls: [{
          index: 0, id: "fixture_missing_article_alternatives", type: "function",
          function: { name: "searchCatalog", arguments: '{"query":"Альт Рабочая станция 10"}' },
        }] }, "tool_calls");
      }
      return stream({}, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_missing_article", type: "function",
      function: { name: "findOffer", arguments: '{"id":"ALT10-0900W"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("образовательное учреждение") && turn.content.includes("Dr.Web Security Space"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_drweb_education", type: "function",
      function: { name: "findOffer", arguments: '{"id":"231538"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("223-ФЗ"))) {
    assert.match(system, /покупатель сверяет с документацией своей процедуры/);
    assert.match(system, /Ни магазин, ни менеджер не подтверждают юридическое соответствие/);
    assert.match(system, /оператора ЭДО и реквизиты компании/);
    return stream({ content: "Магазин может подтвердить состав документов. Требования сверяйте с документацией своей процедуры." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("к домашнему ПК через AnyDesk"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_personal_remote", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"AnyDesk"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("статус заказа после оплаты"))) {
    assert.doesNotMatch(system, /edo@softline\.com/);
    assert.match(system, /ссылк[еу] из письма о заказе/iu);
    assert.match(system, /https:\/\/lk\.softline\.ru\//);
    assert.match(system, /https:\/\/store\.softline\.ru\/contacts\//);
    assert.match(system, /Статус конкретного заказа и срок ответа менеджера чат не видит/);
    return stream({ content: "Для проверки статуса откройте ссылку из письма о заказе или [личный кабинет Softline](https://lk.softline.ru/)." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("скачать закрывающие документы"))) {
    assert.match(system, /Счета и платежи/);
    assert.match(system, /https:\/\/docs\.softline\.com\/ru-ru\/lk\/closing-documents/);
    assert.match(system, /https:\/\/store\.softline\.ru\/contacts\//);
    return stream({ content: "В личном кабинете откройте «Счета и платежи», найдите заказ и нажмите «Закрывающие документы»." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("ещё пять рабочих станций"))) {
    assert.ok(!body.tools?.length || body.tool_choice === "none");
    assert.match(system, /расширение действующей подписки без идентификатора/);
    return stream({ content: "Для расширения на пять станций нужно сверить артикул и срок действующей подписки." }, "stop");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("SNS-8.x-BK1-SB-SP1Y"))) {
    if (tool) {
      const { offers } = JSON.parse(tool.content);
      const exact = offers.length && offers.every(({ article }: { article: string }) => article === "SNS-8.x-BK1-SB-SP1Y");
      return stream({ content: exact
        ? "Найден точный артикул: электронная лицензия на год. Условия договора для школы надо уточнить у менеджера."
        : "Артикул не нашёлся. Есть только другая позиция для Linux." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_known_school_article", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"Secret Net Studio 8 Максимальная защита"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("2048 активов"))) {
    assert.match(system, /Активы и IP-адреса — разные условия лицензирования/);
    if (tool) {
      const { offers } = JSON.parse(tool.content);
      assert.ok(offers.some((offer: { id: string }) => offer.id === "486960"));
      assert.ok(!offers.some((offer: { id: string }) => offer.id === "537333"));
      assert.ok(!offers.some((offer: { id: string }) => ["502637", "541763"].includes(offer.id)));
      return stream({ content: "Основная лицензия на 2048 активов доступна в каталоге." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_scanner_units", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"СКАНЕР-ВС 7 Enterprise 2048 активов","operation":"new","months":12}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("файловый антивирус на Astra Linux SE"))) {
    assert.match(system, /по числу защищаемых серверов, включая виртуальные/);
    if (tool) {
      assert.deepEqual(JSON.parse(tool.content).offers, []);
      return stream({}, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_linux_protection", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"Dr.Web Server Security Suite Unix"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("10 гостевых ВМ"))) {
    const output = tool && JSON.parse(tool.content);
    if (output?.candidates) return stream({ content: "Проверка подтвердила право на 10 ВМ." }, "stop");
    return stream({ tool_calls: [{
      index: 0, id: output ? "fixture_vm_verdict" : "fixture_vm_offer", type: "function",
      function: output
        ? { name: "verifyFit", arguments: '{"ids":["487938"]}' }
        : { name: "findOffer", arguments: '{"id":"487938"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("оформить Microsoft 365"))) {
    if (tool) return stream({ content: "Для организации нужно уточнить корпоративный план и проверить именно его." }, "stop");
    assert.equal(body.tool_choice, "required");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_offer_check", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"Microsoft 365"}' },
    }] }, "tool_calls");
  }
  const adobeRequest = body.messages.find(turn => turn.role === "user" && turn.content.includes("Adobe Photoshop"));
  if (adobeRequest) {
    if (adobeRequest.content.startsWith("Как")) {
      assert.notEqual(body.tool_choice, "required");
      return stream({ content: "Для компании порядок оплаты зависит от типа заказа." }, "stop");
    }
    if (tool) {
      const { offers } = JSON.parse(tool.content);
      assert.ok(offers.length > 0 && offers.every((offer: { availableInCatalog: boolean }) => !offer.availableInCatalog));
      return stream({ content: "Покупку Adobe Photoshop по снимку каталога подтвердить не удалось." }, "stop");
    }
    assert.equal(body.tool_choice, "required");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_adobe_availability", type: "function",
      function: { name: "searchCatalog", arguments: '{"query":"Adobe Photoshop"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("Veeam на 40 инстансов"))) {
    if (tool) {
      const { groups } = JSON.parse(tool.content);
      assert.equal(groups.length, 4);
      assert.equal(groups[0].label, "VMware");
      assert.equal(groups[1].label, "Veeam на 40 инстансов, на год");
      assert.ok(groups[2].matches.some((offer: { id: string }) => offer.id === "380385"));
      return stream({ content: "**VMware.** Срок на год. Оба предложения Windows Server на 16 ядер." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_batch", type: "function",
      function: { name: "searchCatalogBatch", arguments: JSON.stringify({
        groups: [
          { label: "VMware на год", queries: ["VMware", "VMware vCenter", "VMware vSAN"] },
          { label: "Veeam на 40 инстансов", queries: ["Veeam Data Platform Advanced", "Veeam"] },
          { label: "Windows 11 на 150 мест", queries: ["Windows 11 Pro"] },
          { label: "Windows Server: 50 пакетов", queries: ["Windows Server Datacenter 2022"] },
        ],
      }) },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("клиент Континент TLS"))) {
    if (tool) return stream({}, "stop");
    return stream({ tool_calls: [{
      index: 0, id: "fixture_tls", type: "function",
      function: { name: "findOffer", arguments: '{"id":"468275"}' },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("CatalogPhantom"))) {
    if (tool) return stream({}, "stop");
    return stream({
      content: "Проверю каталог.",
      tool_calls: [{
        index: 0, id: "fixture_empty_search", type: "function",
        function: { name: "searchCatalog", arguments: '{"query":"CatalogPhantom"}' },
      }],
    }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("защитить 51 узел"))) {
    if (tool) {
      const { offers } = JSON.parse(tool.content);
      const advanced = offers.find((offer: { id: string }) => offer.id === "503516");
      assert.match(advanced.description, /доступен юрлицам и ИП/);
      assert.match(advanced.description, /311293\.80/);
      const total = offers.find((offer: { id: string }) => offer.id === "5066");
      assert.match(total.description, /https:\/\/support\.kaspersky\.ru\/ks-for-exchange\/9\.7\/28855/);
      return stream({ content: "Нашёл тарифы. Сверим условия защиты Exchange." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_discovery", type: "function",
      function: { name: "discoverCatalog", arguments: JSON.stringify({
        queries: ["kaspersky endpoint security расширенный плюс", "kaspersky total security"],
        users: 51, operation: "new", months: 12,
      }) },
    }] }, "tool_calls");
  }
  if (body.messages.some(turn => turn.role === "user" && turn.content.includes("ActiveSync"))) {
    assert.match(system, /https:\/\/help\.mdaemon\.com\/MDaemon\/en\/activesync--server\.html/);
    if (tool) {
      assert.ok(JSON.parse(tool.content).offers[0].description);
      return stream({ content: "По документации производителя ActiveSync лицензируется отдельно." }, "stop");
    }
    return stream({ tool_calls: [{
      index: 0, id: "fixture_known_offer", type: "function",
      function: { name: "findOffer", arguments: '{"id":"19579"}' },
    }] }, "tool_calls");
  }
  const id = system.includes(absentId) ? absentId : "19579";
  if (tool) {
    const result = JSON.parse(tool.content);
    if (id === absentId) {
      assert.equal(result.error, "Сначала найди эти позиции в каталоге.");
      return stream({ content: "Указанную позицию не удалось найти в каталоге." }, "stop");
    }
    assert.deepEqual(result.candidates, [{ id, verdict: "contradiction", confidence: 1 }]);
    assert.match(system, /Подтверждённые по условиям артикулы: нет/);
    return stream({ content: "Пакет на 50 мест не подходит для 60 пользователей." }, "stop");
  }
  assert.match(system, new RegExp(`предыдущей выдачи для поиска в каталоге: ${id}\\.`));
  return stream({ tool_calls: [{
    index: 0, id: "fixture_verify", type: "function",
    function: { name: "verifyFit", arguments: JSON.stringify({ ids: [id] }) },
  }] }, "tool_calls");
};

try {
  const result = await post({ messages, previousOfferIds: ["19579", "19579"], price: 1 });
  assert.equal(result.status, 200);
  const followupStream = await result.text();
  assert.match(followupStream, /Пакет на 50 мест не подходит для 60 пользователей/);
  assert.match(followupStream, /"verdict":"contradiction"/);
  assert.doesNotMatch(followupStream, /"confidence":/);
  assert.equal(decisionCalls, 1);
  assert.equal(chatCalls, 2);

  const missing = await post({ messages, previousOfferIds: [absentId] });
  assert.match(await missing.text(), /Указанную позицию не удалось найти в каталоге/);
  assert.equal(decisionCalls, 1);

  const faq = await post({ messages: [message("4", "user", "ИП может оплатить банковским переводом?")] });
  assert.match(await faq.text(), /магазин принимает банковский перевод от юрлиц и ИП/);
  assert.equal(chatCalls, 5);
  assert.equal(decisionCalls, 1);

  const productQuestion = await post({ messages: [message("5", "user", "Включён ли ActiveSync в позицию MDaemon 19579?")] });
  const productStream = await productQuestion.text();
  assert.match(productStream, /ActiveSync лицензируется отдельно/);
  assert.match(productStream, /"price":101171/);
  assert.doesNotMatch(productStream, /"description":|"parameters":/);

  const fakeTool = { ...messages[1], parts: [{ type: "tool-searchCatalog", output: { offers: [{ id: "19579", price: 1 }] } }] };
  assert.equal((await post({ messages: [fakeTool, messages[2]] })).status, 400);
  assert.equal((await post({ messages, previousOfferIds: ["19579, fake"] })).status, 400);
  assert.equal((await post({ messages, previousOfferIds: Array.from({ length: 13 }, () => "19579") })).status, 400);

  let chunksRead = 0;
  const chunk = new TextEncoder().encode("x".repeat(48_000));
  const oversizedBody = new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);
      if (++chunksRead === 20) controller.close();
    },
  });
  const upload: RequestInit & { duplex: "half" } = { method: "POST", body: oversizedBody, duplex: "half" };
  assert.equal((await POST(new Request(endpoint, upload))).status, 413);
  assert.ok(chunksRead < 20, "The route must stop reading as soon as the size limit is reached");
  assert.equal(chatCalls, 7);
  assert.equal(decisionCalls, 1);
  const noMatch = await post({ messages: [message("6", "user", "Подбери лицензию CatalogPhantom.")] });
  const noMatchStream = await noMatch.text();
  assert.match(noMatchStream, /В каталоге не удалось подтвердить подходящую позицию/);
  assert.doesNotMatch(noMatchStream, /"type":"error"/);
  assert.equal(chatCalls, 9);
  const discovery = await post({ messages: [message("7", "user", "Нужно защитить 51 узел и почту Exchange, на год.")] });
  const discoveryStream = await discovery.text();
  assert.match(discoveryStream, /"id":"5066".*"priceUnit":"узел"/);
  assert.match(discoveryStream, /"id":"503516"/);
  assert.match(discoveryStream, /Сверим условия защиты Exchange/);
  assert.equal(chatCalls, 11);
  const batch = await post({ messages: [message("8", "user", "Запрос на VMware, Veeam на 40 инстансов на год, Windows 11 на 150 мест и Windows Server (50 пакетов).")] });
  const batchStream = await batch.text();
  const batchAnswer = batchStream.split("\n").flatMap(line => {
    if (!line.startsWith("data: {")) return [];
    const event = JSON.parse(line.slice(6));
    return event.type === "text-delta" ? [event.delta] : [];
  }).join("");
  for (const label of ["VMware", "Veeam на 40 инстансов, на год", "Windows 11 на 150 мест", "Windows Server: 50 пакетов"]) {
    assert.ok(batchAnswer.includes(`**${label}.**`), label);
  }
  assert.doesNotMatch(batchAnswer, /Срок на год|Оба предложения Windows Server на 16 ядер/);
  assert.match(batchAnswer, /электронный ключ/);
  assert.match(batchAnswer, /не подтверждает корпоративную поставку/);
  assert.match(batchAnswer, /351815[^\n]*срок — бессрочная[^\n]*число ядер — 16/);
  assert.match(batchAnswer, /345105[^\n]*срок не указан[^\n]*число ядер не указано/);
  assert.doesNotMatch(batchAnswer, /PROMT|итоговую цену подтверждена/);
  assert.match(batchStream, /"finishReason":"stop"/);
  assert.equal(chatCalls, 12);
  const tls = await post({ messages: [message("9", "user", "Можно купить только клиент Континент TLS? Нужна клиентская лицензия.")] });
  const tlsStream = await tls.text();
  assert.match(tlsStream, /Они не заменяют клиентскую лицензию/);
  assert.match(tlsStream, /распространяется бесплатно/);
  assert.match(tlsStream, /TLS2-TS-KC1/);
  assert.equal(chatCalls, 14);
  const stock = await post({ messages: [message("10", "user", "У вас можно оформить Microsoft 365 для организации?")] });
  const stockStream = await stock.text();
  assert.match(stockStream, /"toolName":"searchCatalog"/);
  assert.match(stockStream, /нужно уточнить корпоративный план/);
  assert.equal(chatCalls, 16);
  const guestVm = await post({ messages: [message("11", "user", "Подойдёт ли лицензия Astra Linux Воронеж 487938 для 10 гостевых ВМ?")] });
  const guestStream = await guestVm.text();
  assert.match(guestStream, /"id":"487938","verdict":"unknown"/);
  assert.match(guestStream, /Условия лицензирования требуемого числа гостевых ВМ в карточке не указаны/);
  assert.doesNotMatch(guestStream, /Проверка подтвердила право на 10 ВМ/);
  assert.equal(chatCalls, 18);
  const linux = await post({ messages: [message("12", "user", "Нужен файловый антивирус на Astra Linux SE для ВМ сервера 1С.")] });
  const linuxStream = await linux.text();
  assert.match(linuxStream, /релиз Astra Linux SE/);
  assert.match(linuxStream, /одну виртуальную машину/);
  assert.match(linuxStream, /https:\/\/cdn-download\.drweb\.com\/pub\/drweb\/unix\/server\/11\.1\/documentation\/html\/en\/sysrequirements\.htm/);
  assert.match(linuxStream, /по числу защищаемых серверов, включая виртуальные/);
  assert.match(linuxStream, /https:\/\/license\.drweb\.ru\/sss\//);
  assert.match(linuxStream, /Наличие и цена конкретной позиции не подтверждены/);
  assert.doesNotMatch(linuxStream, /"type":"error"/);
  assert.equal(chatCalls, 20);
  const scanner = await post({ messages: [message("13", "user", "Нужна основная лицензия СКАНЕР-ВС 7 на 2048 активов.")] });
  const scannerStream = await scanner.text();
  assert.match(scannerStream, /"id":"486960"/);
  assert.doesNotMatch(scannerStream, /"id":"537333"|"type":"error"/);
  assert.equal(chatCalls, 22);
  const expansion = await post({ messages: [message("14", "user", "У компании уже 60 лицензий Kaspersky Endpoint Security Cloud, нужно добавить ещё пять рабочих станций.")] });
  assert.match(await expansion.text(), /артикул и срок действующей подписки/);
  assert.equal(chatCalls, 23);
  const order = await post({ messages: [message("15", "user", "Как проверить статус заказа после оплаты?")] });
  assert.match(await order.text(), /ссылку из письма о заказе или \[личный кабинет Softline\]\(https:\/\/lk\.softline\.ru\/\)/);
  assert.equal(chatCalls, 24);
  const remote = await post({ messages: [message("16", "user", "Физлицу нужен доступ к домашнему ПК через AnyDesk.")] });
  const remoteStream = await remote.text();
  assert.match(remoteStream, /бесплатный режим для личного некоммерческого использования/);
  assert.match(remoteStream, /"id":"402265"/);
  assert.equal(chatCalls, 26);
  const procurement = await post({ messages: [message("17", "user", "Можно гарантировать прохождение закупки по 223-ФЗ с документами через ЭДО?")] });
  assert.match(await procurement.text(), /Требования сверяйте с документацией своей процедуры/);
  assert.equal(chatCalls, 27);
  for (const [i, question] of [
    "Можно ли сейчас купить Adobe Photoshop для юридического лица?",
    "Доступно ли у вас сегодня заказать Adobe Photoshop?",
    "Можете ли ещё оформить Adobe Photoshop?",
  ].entries()) {
    const stream = await (await post({ messages: [message(`adobe-${i}`, "user", question)] })).text();
    assert.match(stream, /"toolName":"searchCatalog"/);
    assert.match(stream, /Покупку Adobe Photoshop по снимку каталога подтвердить не удалось/);
    assert.doesNotMatch(stream, /"type":"error"/);
  }
  const howTo = await post({ messages: [message("purchase-process", "user", "Как у вас можно сегодня оформить Adobe Photoshop для компании, если он в корзине?")] });
  const processStream = await howTo.text();
  assert.match(processStream, /Для компании порядок оплаты зависит от типа заказа/);
  assert.doesNotMatch(processStream, /"toolName"|"type":"error"/);
  const closing = await post({ messages: [message("closing-docs", "user", "Где скачать закрывающие документы по заказу?")] });
  assert.match(await closing.text(), /откройте «Счета и платежи»/);
  const school = await post({ messages: [message("drweb-edu", "user", "Мы образовательное учреждение, нужно КП на 80 лицензий Dr.Web Security Space. Подойдёт цена домашней лицензии?")] });
  const schoolStream = await school.text();
  assert.match(schoolStream, /Для образовательной организации нужна отдельно подтверждённая поставка/);
  assert.match(schoolStream, /Для запроса КП укажите число защищаемых устройств/);
  assert.doesNotMatch(schoolStream, /"type":"error"/);
  const unknownArticle = await post({ messages: [message("unknown-alt", "user", "Подтвердите наличие и цену артикула ALT10-0900W.")] });
  const missingStream = await unknownArticle.text();
  assert.match(missingStream, /По указанному артикулу совпадений в снимке каталога нет/);
  assert.match(missingStream, /Цену и наличие подтвердить не удалось/);
  const unknownWithAlternatives = await post({ messages: [message("unknown-alt-with-neighbors", "user",
    "Подтвердите наличие и цену артикула ALT10-0900W, проверьте также похожие позиции.")] });
  const alternativesStream = await unknownWithAlternatives.text();
  assert.match(alternativesStream, /"toolName":"searchCatalog"/);
  assert.match(alternativesStream, /По указанному артикулу совпадений в снимке каталога нет/);
  assert.match(alternativesStream, /Цену и наличие подтвердить не удалось/);
  const elbrus = await post({ messages: [message("missing-elbrus", "user", elbrusQuestion)] });
  const elbrusStream = await elbrus.text();
  assert.match(elbrusStream, /ALT10-0900W совпадений в снимке каталога нет/);
  assert.match(elbrusStream, /Цену и наличие подтвердить не удалось/);
  assert.match(elbrusStream, /Эльбрус-8СВ использует e2kv5\. ARMv8 — другая архитектура\./u);
  assert.match(elbrusStream, /https:\/\/www\.basealt\.ru\/knowledge_base\/Specification_ALT_Server_10\.4\.html/u);
  assert.doesNotMatch(elbrusStream, /ARMv8 совместима|10 560 ₽|"type":"error"/u);
  const knownSchoolArticle = await post({ messages: [message("known-school-article", "user",
    "Мы школа. Можно ли купить через договор Secret Net Studio 8 «Максимальная защита», электронная лицензия на год, артикул SNS-8.x-BK1-SB-SP1Y?")] });
  assert.equal(knownSchoolArticle.status, 200);
  const schoolArticleStream = await knownSchoolArticle.text();
  assert.match(schoolArticleStream, /Найден точный артикул: электронная лицензия на год/);
  for (const id of ["505189", "505190", "505191", "505192"]) assert.match(schoolArticleStream, new RegExp(`"id":"${id}"`));
  assert.doesNotMatch(schoolArticleStream, /не нашёлся|для Linux|"type":"(?:tool-output-error|error)"/);
  const concurrent = await post({ messages: [message("concurrent", "user", "Для ContentReader PDF 16 рассматриваем 300 одновременных подключений. Сколько стоит?")] });
  const concurrentStream = await concurrent.text();
  assert.match(concurrentStream, /Конкурентная лицензия есть в снимке каталога/);
  assert.match(concurrentStream, /итоговую стоимость на весь объём подтвердить не удалось/);
  assert.doesNotMatch(concurrentStream, /5 921 700|"type":"error"/);
  const workplace = await post({ messages: [message("workplace", "user", "Есть ли бессрочная лицензия КриптоАРМ ГОСТ на одно рабочее место?")] });
  const workplaceStream = await workplace.text();
  assert.match(workplaceStream, /"id":"420998"/);
  assert.match(workplaceStream, /"id":"452169"/);
  const astraCatalogOnly = await post({ messages: [message("astra-catalog-only", "user",
    "Нужен сервер Astra Linux «Воронеж», до 10 виртуальных машин и базовая техподдержка на год. Какая именно лицензия подойдёт?")] });
  const astraCatalogOnlyStream = await astraCatalogOnly.text();
  assert.match(astraCatalogOnlyStream, /487938 каталог указывает/);
  assert.match(astraCatalogOnlyStream, /срок действия — бессрочная/);
  assert.match(astraCatalogOnlyStream, /срок техподдержки — 12 мес/);
  assert.match(astraCatalogOnlyStream, /Условия лицензирования требуемого числа гостевых ВМ в карточке не указаны/);
  const compare = await post({ messages: [message("alt-pve", "user", "Сравните варианты Альт Виртуализация 11 для x86_64, редакция PVE.")] });
  const comparisonStream = await compare.text();
  assert.match(comparisonStream, /"id":"496968","verdict":"fit"/);
  assert.doesNotMatch(comparisonStream, /"type":"tool-output-error"|"type":"error"/);
  const revisedTier = await post({ messages: [
    message("tier-1", "user", "Нужна лицензия Kaspersky, артикул KL4863RAPFS, на 40 узлов."),
    message("tier-2", "user", "Объём изменился: будет 20 узлов. Можно ли оставить тот же артикул и цену?"),
  ], previousOfferIds: ["4985"] });
  const revisedTierStream = await revisedTier.text();
  assert.match(revisedTierStream, /KL4863RAPFS.*от 25 до 49 узлов.*Объём 20/);
  assert.match(revisedTierStream, /Для пересчёта нужна цена за узел по тарифу нового объёма/);
  const educationPrice = await post({ messages: [message("academic-price", "user", "Учреждению образования полагается академическая цена?")] });
  assert.match(await educationPrice.text(), /Менеджер магазина подскажет, какой документ подтвердит образовательный статус/);
  const previousChatCalls = chatCalls;
  const previousDecisionCalls = decisionCalls;
  const document = await post({ messages: [message("document-follow-up", "user", documentFollowUp)],
    previousOfferIds: ["222182", "222179", "19579"] });
  const documentStream = await document.text();
  const toolOutputs = documentStream.split("\n")
    .filter(line => line.startsWith("data: {\"type\":\"tool-output-available\""))
    .map(line => JSON.parse(line.slice(6)).output);
  assert.deepEqual(toolOutputs, [{
    candidates: [{ id: "222179", verdict: "contradiction" }, { id: "222182", verdict: "fit" }],
    offers: [{
      id: "222182",
      name: "Kaspersky Endpoint Security Cloud продление на 1 год по количеству рабочих станций/файловых серверов",
      url: "https://store.softline.ru/kaspersky/kl4742raqfr-222182/",
      price: 1896.3,
      currency: "RUR",
      priceUnit: "рабочую станцию или файловый сервер",
      availableInCatalog: true,
      maxUsers: null,
      licenseOperation: "renewal",
      licenseTerm: "12 мес.",
      quantityBounds: { min: 50, max: 99 },
    }],
  }]);
  assert.equal(chatCalls - previousChatCalls, 2);
  assert.equal(decisionCalls - previousDecisionCalls, 1);
  const installation = await post({ messages: [message("installation-failure", "user", installationQuestion)] });
  const installationStream = await installation.text();
  assert.match(installationStream, /какой продукт и версию/);
  assert.match(installationStream, /официальный сайт производителя/);
  const promotion = await post({ messages: [message("promotion-check", "user", promotionQuestion)] });
  const promotionStream = await promotion.text();
  assert.match(promotionStream, /продукт и редакцию/);
  assert.match(promotionStream, /условий программы и конкретного артикула/);
  const purchase = await post({ messages: [message("private-purchase", "user", privatePurchaseQuestion)] });
  const purchaseStream = await purchase.text();
  assert.match(purchaseStream, /если условия позиции это допускают/);
  assert.doesNotMatch(purchaseStream, /Не удалось закончить подбор/);
  const bundle = await post({ messages: [message("bundle-price", "user", bundlePriceQuestion)] });
  const bundleStream = await bundle.text();
  assert.match(bundleStream, /"id":"438375"/);
  assert.match(bundleStream, /"id":"542049"/);
  assert.match(bundleStream, /Единицу цены нужно уточнить/);
  assert.match(bundleStream, /нельзя подтвердить количество единиц к покупке и итоговую сумму/);
  const renewal = await post({ messages: [message("renewal-eligibility", "user", renewalQuestion)] });
  const renewalStream = await renewal.text();
  assert.match(renewalStream, /"id":"486969"/);
  assert.match(renewalStream, /за 966 000 ₽/);
  assert.doesNotMatch(renewalStream, /"type":"error"/);
  const selected = await post({ messages: [
    message("selected-offer", "user", "Проверьте месячную подписку Visual Paradigm Teamwork Server 41159."),
    message("selected-reply", "assistant", "Позиция 41159 на месяц за 43 210 ₽ недоступна по снимку."),
    message("selected-documents", "user", selectedDocumentFollowUp),
  ], previousOfferIds: ["41159"] });
  const selectedStream = await selected.text();
  assert.match(selectedStream, /"id":"41159".*"availableInCatalog":false.*"documentQuantity":1/);
  assert.match(selectedStream, /43[\p{Zs}]210/u);
  assert.match(selectedStream, /Фактическую поставку и её срок подтверждает менеджер/);
  assert.match(selectedStream, /"finishReason":"stop"/);
  assert.doesNotMatch(selectedStream, /"type":"error"|"type":"tool-output-error"/);
  for (const check of scopedLicenseChecks) {
    const prior = "previous" in check ? [message("old-license", "user", check.previous)] : [];
    const result = await post({ messages: [...prior, message("license-facts", "user", check.question)] });
    const text = await result.text();
    const reply = text.split("\n").filter(line => line.startsWith("data: {\"type\":\"text-delta\""))
      .map(line => JSON.parse(line.slice(6)).delta).join("").replaceAll("\n", " ");
    assert.match(reply, check.answer);
    assert.match(text, /"finishReason":"stop"/);
    assert.doesNotMatch(text, /"type":"error"|"type":"tool-output-error"/);
  }
  for (const { question } of storePolicyChecks) {
    const result = await post({ messages: [message("store-policy", "user", question)] });
    assert.match(await result.text(), /Ответ по правилам магазина/, question);
  }
  const packageQuote = await post({ messages: [message("package-quote", "user", packageQuoteQuestion)] });
  const packageStream = await packageQuote.text();
  assert.match(packageStream, /"id":"499760","verdict":"fit"/);
  assert.match(packageStream, /230[\p{Zs}]000 ₽ за одну позицию/u);
  assert.match(packageStream, /Демо-КП и счёт» в карточке.*количество 1/);
  const repriced = await post({
    messages: [
      message("original-tier", "user", "Сравните бессрочные локальные позиции GstarCAD 2027 532973, 532974, 532975, 532976 на 4 лицензии."),
      message("updated-tier", "user", tierRepriceQuestion),
    ],
    previousOfferIds: ["532973", "532974", "532975", "532976"],
  });
  const repricedStream = await repriced.text();
  assert.match(repricedStream, /532973.*42[\p{Zs}]900 ₽ за лицензию.*514[\p{Zs}]800 ₽/u);
  assert.doesNotMatch(repricedStream, /"type":"error"|191[\p{Zs}]600/u);
  console.log("Chat smoke: hard constraints, discovery, empty result, SKU, FAQ, stream projection and payload limits passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.POLZA_API_KEY;
  else process.env.POLZA_API_KEY = originalKey;
  if (originalSupportDb === undefined) delete process.env.SUPPORT_DB;
  else process.env.SUPPORT_DB = originalSupportDb;
  rmSync(state, { recursive: true, force: true });
}
