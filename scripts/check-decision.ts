import assert from "node:assert/strict";
import { openCatalog } from "../lib/catalog.ts";
import { assessFit } from "../lib/decision.ts";

const catalog = openCatalog();
const originalFetch = globalThis.fetch;
let providerChoice = "fit";
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(request.url, "https://polza.ai/api/v1/systemone");
  const { questions } = await request.json();
  return Response.json({
    answers: Object.fromEntries(Object.keys(questions).map(key => [key, {
      type: "choice", choice: providerChoice, confidence: 0.91,
    }])),
  });
};

async function verdicts(requirements: string, ...ids: string[]) {
  const offers = ids.map(id => {
    const offer = catalog.find(id).find(item => item.id === id);
    assert.ok(offer, `Expected SKU ${id} in the catalog snapshot`);
    return offer;
  });
  const { candidates } = await assessFit("local-fixture", `Покупатель: ${requirements}`, offers);
  return candidates.map(candidate => candidate.verdict);
}

try {
  assert.deepEqual(await verdicts(
    "Нужна лицензия на 50 пользователей.\nПомощник: Подходит 50?\nПокупатель: Исправление: нужно 60 мест.",
    "19579", "19580"), ["contradiction", "fit"], "A 50-seat license cannot cover the corrected request for 60");
  assert.deepEqual(await verdicts(
    "Нужна лицензия на 50 пользователей.\nПокупатель: Уточнение: всё то же, но нужно 60 пользователей.",
    "19579", "19580"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts("Надо 60 рабочих мест.\nПомощник: 50 мест хватит?", "19579"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужно 1 060 пользователей", "19579"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужно 49 пользователей", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("MDaemon на 50 пользователей, а для офисного ПО нужно 60 рабочих мест.", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("MDaemon на 50 пользователей и отдельная лицензия для 60 устройств.", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("Для MDaemon нужно 50 пользователей.\nПокупатель: Для другого офиса надо 60 мест.", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("Подберите MDaemon на 50 или 60 пользователей.", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("Не нужен вариант на 60 мест.", "19579"), ["fit"]);
  assert.deepEqual(await verdicts("Для этого продукта нужно 60 пользователей.", "477554"), ["unknown"]);
  assert.deepEqual(await verdicts("Новая лицензия на 50 пользователей.", "19579", "19590"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts("Нужно продление.", "19579", "19590", "19601"), ["contradiction", "fit", "unknown"]);
  assert.deepEqual(await verdicts("Нужно продление просроченной подписки.", "19590", "19601"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts(
    "Проверьте СКАНЕР-ВС 7, позицию 486969. Это продление Enterprise на год и на 2048 активов? Какова цена в каталоге?\n" +
    "Помощник: Это продление лицензии Enterprise на 1 год.\n" +
    "Покупатель: Уточнение: действующей лицензии нет, покупаем впервые. Редакция, год и 2048 активов остаются. Какая позиция подойдёт и сколько стоит?",
    "486960", "486969", "537333"), ["fit", "contradiction", "contradiction"]);
  assert.deepEqual(await verdicts(
    "Сравните СКАНЕР-ВС на 2048 активов и на 2048 IP-адресов.",
    "486960", "537333"), ["fit", "fit"]);
  assert.deepEqual(await verdicts(
    "СКАНЕР-ВС, основная лицензия на 2048 IP-адресов.",
    "486960", "537333"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts(
    "Интересует бессрочная серверная лицензия КриптоПро CSP 5.0 для Windows.",
    "197958", "365871"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts(
    "Сравните серверные КриптоПро CSP и КриптоПро CSP TLS.",
    "197958", "365871"), ["fit", "fit"]);
  assert.deepEqual(await verdicts(
    "Это продление Enterprise?\nПокупатель: Покупаем впервые.",
    "486960", "486969"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts(
    "У компании уже 60 лицензий Kaspersky Endpoint Security Cloud, хотим добавить защиту ещё на пять рабочих станций. Достаточно купить отдельные пять? Если нужно уточнение, скажите какое.",
    "222172", "222179"), ["unknown", "unknown"]);
  assert.deepEqual(await verdicts(
    "Можно купить продление Kaspersky Endpoint Security Cloud на 65 рабочих станций?",
    "222179", "222182"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts(
    "Можно купить продление на 65 файловых серверов? Бюджет до 120 000 ₽.",
    "222182"), ["contradiction"]);
  assert.deepEqual(await verdicts(
    "Есть действующая подписка. Хотим добавить защиту, итого 65 рабочих станций.",
    "222179", "222182"), ["contradiction", "unknown"]);
  assert.deepEqual(await verdicts(
    "Нужно продление Kaspersky Endpoint Security Cloud. В компании 65 сотрудников.",
    "222179", "222182"), ["fit", "fit"]);
  assert.deepEqual(await verdicts(
    "У нас есть действующая подписка.\nПокупатель: Хотим добавить ещё 5 узлов.",
    "5066"), ["unknown"]);
  assert.deepEqual(await verdicts(
    "У нас есть действующая подписка.\nПокупатель: Хотим добавить ещё 5 узлов, после расширения итого 101 узел.",
    "5066"), ["contradiction"]);
  assert.deepEqual(await verdicts("Новая лицензия.", "532583"), ["unknown"]);
  assert.deepEqual(await verdicts("Срок лицензии: 12 месяцев.", "536417", "536422", "532583"), ["contradiction", "fit", "unknown"]);
  assert.deepEqual(await verdicts(
    "Какую версию Astra Linux Special Edition в редакции «Воронеж» вы сейчас можете предложить?\n" +
    "Помощник: Есть Astra Linux Special Edition 1.8 уровня «Усиленный».\n" +
    "Покупатель: Нужен один сервер x86-64, до 10 виртуальных машин и базовая техподдержка на год. Какая именно лицензия подойдёт?",
    "488831", "487938"), ["contradiction", "unknown"]);
  assert.deepEqual(await verdicts(
    "Достаточно ли одной лицензии Astra Linux SE 488831, чтобы покрыть 10 гостевых ВМ?",
    "488831"), ["unknown"]);
  assert.deepEqual(await verdicts(
    "Подойдёт ли лицензия Astra Linux Воронеж 487938 для 10 гостевых ВМ?",
    "487938"), ["unknown"]);
  assert.deepEqual(await verdicts(
    "Сравните Astra Linux SE 487938 и 488831 для сценария на 10 ВМ.",
    "487938", "488831"), ["fit", "fit"]);
  assert.deepEqual(await verdicts(
    "В инфраструктуре уже есть 10 виртуальных машин. Какова цена позиции Astra Linux SE 487938?",
    "487938"), ["fit"]);
  assert.deepEqual(await verdicts(
    "Нужна Astra Linux Special Edition «Воронеж».\nПокупатель: Теперь нужна редакция «Смоленск».",
    "488831", "487944"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts(
    "Нужна Astra Linux Special Edition «Воронеж».\nПокупатель: Вместо «Воронеж» выбираем «Смоленск».",
    "488831", "487944"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts(
    "Нужна Astra Linux Special Edition «Воронеж».\nПокупатель: Нужен базовый уровень техподдержки.",
    "488831", "487944"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts(
    "Нужна Astra Linux Special Edition «Воронеж».\nПокупатель: Сравните с «Орлом».",
    "488641", "487944"), ["fit", "fit"]);
  assert.deepEqual(await verdicts(
    "Нужна Astra Linux SE уровня «Базовый».", "488641", "487944"), ["fit", "contradiction"]);
  assert.deepEqual(await verdicts(
    "Работаем в Воронеже, интересует серверная Astra Linux SE.", "488831", "487944"), ["fit", "fit"]);
  assert.deepEqual(await verdicts("Срок лицензии: 12 месяцев.\nПокупатель: Ровно на 50 рабочих мест.", "536417"), ["contradiction"]);
  assert.deepEqual(await verdicts("Обновления на год.", "477654"), ["fit"]);
  assert.deepEqual(await verdicts("Бюджет до 100 000 рублей.", "19579", "10000"), ["contradiction", "unknown"]);
  assert.deepEqual(await verdicts("Можно купить F5 BIG-IP сейчас?", "100599"), ["contradiction"]);
  assert.deepEqual(await verdicts("Хочу купить этот товар.", "100599", "19579"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts("Объясните, как купить товар на сайте.", "100599"), ["fit"]);
  assert.deepEqual(await verdicts("Хочу купить как физическое лицо.", "19579"), ["contradiction"]);
  assert.deepEqual(await verdicts("Мы образовательное учреждение. Подойдёт Dr.Web Security Space?", "231538"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужна лицензия на 300 одновременных подключений.", "525816"), ["unknown"]);
  assert.deepEqual(await verdicts(
    "Для 14 сотрудников и восьми управляемых компьютеров хватит ли купить восемь лицензий на право подключения одного клиента?",
    "541992"), ["unknown"], "A listed client right does not establish device or employee coverage");
  assert.deepEqual(await verdicts("Сколько клиентских лицензий нужно для 8 компьютеров?", "541992"), ["unknown"]);
  assert.deepEqual(await verdicts("Нужно именно право подключения одного клиента. Сколько оно стоит?", "541992"), ["fit"]);
  assert.deepEqual(await verdicts(
    "Нужен локальный RuDesktop. Подтверждает ли карточка управляющего сервера, что конкурентные подключения уже включены?",
    "518158", "487234"), ["unknown", "contradiction"], "A management-server license is not evidence of included connections");
  assert.deepEqual(await verdicts("Сколько стоит локальный управляющий сервер без проверки комплектности?", "518158"), ["fit"]);
  assert.deepEqual(await verdicts("Нам не нужен локальный вариант, нужен облачный.", "518158", "487234"), ["contradiction", "fit"]);
  assert.deepEqual(await verdicts("Нужна точно бессрочная лицензия без физической поставки.", "433270"), ["unknown"]);
  assert.deepEqual(await verdicts("Срок лицензии: 12 месяцев.", "433270"), ["unknown"], "Conflicting term fields prove neither fit nor contradiction");
  assert.deepEqual(await verdicts("Какова цена этой позиции по каталогу?", "433270"), ["fit"]);
  assert.deepEqual(await verdicts("Подходит ли годовая электронная подписка Navicat для некоммерческой организации?", "283688"), ["unknown"]);
  assert.deepEqual(await verdicts("Мы НКО, не учебная и не государственная организация. Подходит ли эта подписка?", "283688"), ["unknown"]);
  assert.deepEqual(await verdicts("Мы университет. Подходит ли эта подписка для нас?", "283688"), ["fit"]);
  assert.deepEqual(await verdicts("Я самозанятый, подходит ли лицензия КриптоПро?", "365874"), ["unknown"]);
  assert.deepEqual(await verdicts("Мы школа. Можно ли купить лицензию по договору?", "505192", "5001"), ["unknown", "fit"]);
  assert.deepEqual(await verdicts("Покупаем для муниципального учреждения.", "505192", "283688"), ["unknown", "fit"]);
  assert.deepEqual(await verdicts("Нужны демо-КП и проект счёта на одну позицию 100599.", "100599"), ["fit"]);
  assert.deepEqual(await verdicts("Можно ли купить позицию 100599? Она в наличии?", "100599"), ["contradiction"]);
  assert.deepEqual(await verdicts(
    "Мы школа. Подходит ли лицензия?\nПокупатель: Уточнение: покупатель — коммерческая организация.",
    "505192"), ["fit"]);
  assert.deepEqual(await verdicts("Цена не выше 300000 ₽.", "5066", "3850"), ["unknown", "unknown"]);
  assert.deepEqual(await verdicts("Нужен RedCheck на 10 IP-адресов. Бюджет до 10 000 ₽.", "143402"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужен RedCheck на 10 IP-адресов. Бюджет до 43 500 ₽.", "143402"), ["fit"]);
  assert.deepEqual(await verdicts("Нужна лицензия на 49 почтовых адресов.", "3850"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужна лицензия на 50 почтовых адресов. Бюджет до 83 547 ₽.", "3850"), ["fit"]);
  assert.deepEqual(await verdicts("Нужно 51 узел. Общий бюджет до 300 000 ₽.", "5066", "503516", "3850"), ["contradiction", "contradiction", "unknown"]);
  assert.deepEqual(await verdicts(
    "Бюджет до 500 000 ₽ суммарно.\nПокупатель: Всего 51 узел, включая файловый сервер, 50 почтовых ящиков. Exchange Server 2019 CU15, роль Mailbox.",
    "503516", "5066"), ["fit", "fit"]);
  assert.deepEqual(await verdicts("Нужно 51 узел. Бюджет до 100 000 ₽.", "4986"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужно 51 узел. Бюджет до 150 000 ₽.", "4986"), ["fit"]);
  assert.deepEqual(await verdicts("Нужно 101 узел. Бюджет до 300 000 ₽.", "5066"), ["contradiction"]);
  assert.deepEqual(await verdicts("Нужно 101 узел.", "5066"), ["contradiction"]);
  assert.deepEqual(await verdicts("Бюджет до 300 000 ₽ для 51 сотрудника, почта на 60 ящиков.", "5066"), ["unknown"]);
  providerChoice = "contradiction";
  assert.deepEqual(await verdicts("Бюджет до 100 000 ₽.", "10000"), ["contradiction"]);
  assert.deepEqual(await verdicts("Покупаем для школы.", "505192"), ["contradiction"]);
  providerChoice = "unknown";
  assert.deepEqual(await verdicts("Нужна новая лицензия на 60 пользователей.", "19579", "19580"), ["contradiction", "unknown"]);
  console.log("Decision checks passed on the catalog snapshot with simulated provider verdicts.");
} finally {
  globalThis.fetch = originalFetch;
  catalog.close();
}
