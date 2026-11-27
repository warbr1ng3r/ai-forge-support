import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { catalogPath, coversQuantityTier, openCatalog } from "../lib/catalog.ts";

const catalog = openCatalog();
const db = new DatabaseSync(catalogPath, { readOnly: true });

try {
  const samples = db.prepare(`
    SELECT count(*) AS total,
      sum(price IS NULL) AS missingPrice,
      sum(price > 0 AND available = 0) AS pricedUnavailable,
      min(CASE WHEN price IS NULL AND available = 0 THEN id END) AS missingPriceId,
      min(CASE WHEN price > 0 AND available = 0 THEN id END) AS pricedUnavailableId
    FROM offers
  `).get()!;
  assert.equal(samples.total, 136_040);
  assert.equal(samples.missingPrice, 80_269);
  assert.equal(samples.pricedUnavailable, 11_170);
  const { missingPriceId, pricedUnavailableId } = samples;
  assert.ok(typeof missingPriceId === "string");
  assert.ok(typeof pricedUnavailableId === "string");
  const missing = catalog.find(missingPriceId).find(offer => offer.id === missingPriceId);
  const unavailable = catalog.find(pricedUnavailableId).find(offer => offer.id === pricedUnavailableId);
  assert.ok(missing);
  assert.equal(missing.price, null);
  assert.equal(missing.availableInCatalog, false);
  assert.ok(unavailable);
  assert.ok(unavailable.price !== null && unavailable.price > 0);
  assert.equal(unavailable.availableInCatalog, false);

  for (const offers of [
    catalog.search("Astra Linux Воронеж"),
    catalog.discover(["Astra Linux Воронеж"]),
  ]) {
    assert.ok(offers.some(offer => offer.id === "488094"), "An Astra-only lookup must surface the OS before the result limit");
    assert.ok(offers.every(offer => offer.name.startsWith("Astra Linux ")));
  }
  assert.ok(catalog.search("Астра Линукс Воронеж сервер").some(offer => offer.id === "487938"));
  assert.ok(catalog.search("техподдержка Astra Linux").some(offer => offer.id === "482091"));
  assert.ok(catalog.search("Astra Linux Panorama").some(offer => offer.vendor === "Панорама КБ"));
  const mixed = catalog.discover(["Astra Linux Воронеж", "Панорама Astra Linux"]);
  assert.ok(mixed.some(offer => offer.vendor === "Группа Астра") && mixed.some(offer => offer.vendor === "Панорама КБ"));

  const cases = [
    { id: "19579", operation: "new", price: 101_171 },
    { id: "19590", operation: "renewal", price: 50_585 },
    { id: "19601", operation: "expired_renewal", price: 80_937 },
  ] as const;
  for (const { id, operation, price } of cases) {
    const offers = catalog.search("MDaemon Messaging Server", 50, operation);
    assert.deepEqual(offers.map(offer => offer.id), [id], operation);
    assert.equal(offers[0].licenseOperation, operation);
    assert.equal(offers[0].maxUsers, 50);
    assert.equal(offers[0].price, price);
    assert.equal(offers[0].availableInCatalog, true);
  }

  for (const [requested, capacity, id] of [[49, 50, "19579"], [51, 60, "19580"]] as const) {
    const offers = catalog.search("MDaemon Messaging Server", requested, "new");
    assert.deepEqual(offers.map(offer => [offer.maxUsers, offer.id]), [[capacity, id]]);
  }
  for (const query of ["MDaemon Email Server", "MDaemon Email Server 60"]) {
    assert.deepEqual(catalog.search(query, 60, "new").map(offer => offer.id), ["19580"]);
  }
  const origin = catalog.search("OriginPro EDU Nodelock 20 SEATS", 20, "new", 12);
  assert.deepEqual(
    origin.map(({ id, maxUsers, price, availableInCatalog }) => ({ id, maxUsers, price, availableInCatalog })),
    [{ id: "365609", maxUsers: 20, price: null, availableInCatalog: false }],
  );
  assert.equal(catalog.find("365609")[0]?.maxUsers, 20);
  assert.deepEqual(catalog.discover(["OriginPro EDU Nodelock"], { users: 20, operation: "new", months: 12 }), []);
  for (const [query, id] of [
    ["Kaspersky Endpoint Security для бизнеса Расширенный Плюс", "503516"],
    ["Kaspersky Total Security для бизнеса", "5066"],
  ]) {
    const offers = catalog.search(query, 51, "new", 12);
    assert.equal(offers[0]?.id, id, query);
    assert.ok(offers.every(offer => offer.parameters["К-во узлов"]?.includes("51")));
    assert.ok(offers.every(offer => offer.parameters["Срок действия"]?.includes("12 мес.")));
    assert.ok(!catalog.search(query, 49, "new", 12).some(offer => offer.id === id));
  }
  assert.equal(catalog.find("5021")[0]?.licenseOperation, "upgrade");
  assert.equal(catalog.search("Kaspersky Total Security Cross-grade", 51, "new", 12).length, 0);
  assert.ok(catalog.search("Kaspersky Total Security Cross-grade", 51, "upgrade", 12).some(offer => offer.id === "5018"));
  assert.ok(catalog.search("Kaspersky Total Security Cross-grade", 251, "upgrade", 12).some(offer => offer.id === "5021"));

  const cloud = "Kaspersky Endpoint Security Cloud";
  const renewalTier = catalog.find("222182")[0];
  assert.deepEqual(renewalTier.parameters["К-во по тарифу"], ["50", "99"]);
  assert.equal(renewalTier.maxUsers, null);
  assert.equal(renewalTier.price, 1_896.30);
  assert.equal(coversQuantityTier(renewalTier.parameters, 49), false);
  assert.equal(coversQuantityTier(renewalTier.parameters, 65), true);
  for (const result of [catalog.search(cloud, 65, "renewal", 12),
    catalog.discover([cloud], { users: 65, operation: "renewal", months: 12 })]) {
    assert.ok(result.some(offer => offer.id === "222182"));
    assert.ok(!result.some(offer => ["222179", "222180", "222181"].includes(offer.id)));
  }
  assert.ok(!catalog.search(cloud, 49, "renewal", 12).some(offer => offer.id === "222182"));
  assert.deepEqual(catalog.find("3850")[0].parameters["К-во по тарифу"], ["50", "99"]);
  const openTier = catalog.find("413856")[0].parameters;
  assert.deepEqual(openTier["К-во по тарифу"], ["500"]);
  assert.equal(coversQuantityTier(openTier, 499), false);
  assert.equal(coversQuantityTier(openTier, 501), true);
  for (const query of ["Касперский", "Kaspersky"]) {
    const offers = catalog.search(query);
    assert.ok(offers.length > 0, query);
    assert.ok(offers.every(offer => offer.vendor === "«Лаборатория Касперского»"), query);
    assert.match(offers[0].name, /^Kaspersky /, query);
    assert.equal(offers[0].availableInCatalog, true, query);
  }

  for (const offers of [catalog.search("RedCheck"), catalog.discover(["RedCheck"])]) {
    const professional = offers.find(offer => offer.id === "143402");
    assert.ok(professional);
    assert.equal(professional.price, 4_350);
    assert.equal(professional.licenseOperation, "new");
    assert.match(professional.description, /от 10 до 24 шт\./u);
    assert.ok(offers.some(offer => offer.licenseOperation === "new" && offer.name.includes("лицензия Base")));
  }
  assert.equal(catalog.search("RedCheck техническая поддержка")[0]?.id, "448853");
  assert.equal(catalog.search("RedCheck медиа комплект")[0]?.id, "36949");
  const tls = catalog.search("Континент TLS VPN");
  assert.ok(tls.some(offer => offer.id === "468275" && !offer.availableInCatalog));
  assert.ok(tls.some(offer => offer.id === "436613" && !offer.availableInCatalog));

  const scanner = catalog.search("СКАНЕР-ВС Enterprise 2048 активов", undefined, "new", 12);
  assert.equal(scanner[0]?.id, "486960");
  assert.equal(scanner[0]?.price, 2_415_000);
  assert.ok(scanner.some(offer => offer.id === "502637"));

  const connector = catalog.search("MDaemon Connector Outlook", 50, "new").find(offer => offer.id === "359849");
  assert.ok(connector);
  assert.match(connector.name, /Connector for Outlook/);
  assert.equal(connector.price, 60_193);
  assert.equal(catalog.search("MDaemon Standard", 50).length, 0);

  const workplaceBundle = catalog.search("ос офис антивирус почта год", 50, "new")
    .find(offer => offer.id === "536422");
  assert.ok(workplaceBundle, "The complete 50-seat annual bundle stays in filtered search");
  assert.equal(workplaceBundle.maxUsers, 50);
  assert.equal(workplaceBundle.licenseOperation, "new");
  assert.equal(workplaceBundle.price, 4_800_529);

  const liveBundleQuery = "комплект 50 рабочих мест операционная система офис антивирус почта";
  assert.ok(catalog.search(liveBundleQuery).some(offer => offer.id === "536422"), liveBundleQuery);
  const liveBundleCandidates = catalog.search(liveBundleQuery, 50, "new");
  assert.ok(liveBundleCandidates.some(offer => offer.id === "536422"), liveBundleQuery);

  const mailDiscovery = ["почтовый шлюз", "email gateway", "mail security"];
  const foundMail = catalog.discover(mailDiscovery, { users: 50, operation: "new", maxPrice: 500_000 });
  assert.ok(foundMail.some(offer => offer.id === "532583"));
  assert.ok(foundMail.some(offer => offer.id === "528073"));
  assert.ok(foundMail.every(offer => offer.availableInCatalog && offer.price != null && offer.price <= 500_000));
  assert.ok(foundMail.every(offer => offer.licenseOperation === "new" || offer.licenseOperation == null));
  assert.ok(!catalog.discover(mailDiscovery, { maxPrice: 99_999 }).some(offer => offer.id === "532583"));

  const fileDiscovery = catalog.discover(["антивирус файловых серверов", "server security"], {
    users: 1, operation: "new", maxPrice: 500_000,
  });
  assert.ok(fileDiscovery.some(offer => offer.id === "532803"));
  assert.ok(!fileDiscovery.some(offer => offer.parameters["Тип лицензии"]?.includes("Миграция")));
  const nodeDiscovery = ["kaspersky total security базов", "kaspersky endpoint security расширенный base"];
  for (const quantity of [50, 51]) {
    const nodal = catalog.discover(nodeDiscovery, { users: quantity, operation: "new", maxPrice: 500_000 });
    assert.ok(nodal.some(offer => offer.id === "5066"), `Kaspersky Total Security quantity ${quantity}`);
    assert.ok(nodal.some(offer => offer.id === "4857"), `Kaspersky Endpoint Security quantity ${quantity}`);
    assert.ok(nodal.every(offer => offer.parameters["К-во узлов"]?.includes(String(quantity)) !== false));
  }
  assert.ok(!catalog.discover(nodeDiscovery, { users: 49, operation: "new" }).some(offer => offer.id === "5066"));
  const annualDiscovery = catalog.discover(["kaspersky endpoint security расширенный плюс", "kaspersky total security"], {
    users: 51, operation: "new", months: 12,
  });
  assert.ok(annualDiscovery.some(offer => offer.id === "503516"));
  assert.ok(annualDiscovery.some(offer => offer.id === "5066"));
  assert.ok(!annualDiscovery.some(offer => offer.parameters["Срок действия"]?.includes("24 мес.")));
  assert.ok(catalog.discover(mailDiscovery, { months: 12 }).some(offer => offer.id === "532583"));
  const mailboxDiscovery = catalog.discover(["kaspersky security почтовых серверов базов 1 год"], {
    users: 50, operation: "new",
  });
  assert.ok(mailboxDiscovery.some(offer => offer.id === "3850" && offer.maxUsers == null));
  assert.deepEqual(catalog.discover(["?!"]), []);

  const needs = [
    { query: "защита почты", example: /Positive Technologies Email Gateway/ },
    { query: "защита файлов", example: /Кибер Файлы/ },
  ];
  const timings = needs.map(({ query, example }) => {
    const candidates = catalog.search(query);
    assert.ok(candidates.some(offer => example.test(offer.name)), query);
    const durations = Array.from({ length: 25 }, () => {
      const start = performance.now();
      catalog.search(query);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    return {
      query,
      candidateIds: candidates.map(offer => offer.id),
      p50_ms: Number(durations[12].toFixed(2)),
      p95_ms: Number(durations[23].toFixed(2)),
    };
  });
  console.log(JSON.stringify({ offers: samples.total, missingPriceId: missing.id, pricedUnavailableId: unavailable.id, timings }, null, 2));
} finally {
  db.close();
  catalog.close();
}
