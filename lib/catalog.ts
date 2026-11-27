import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const catalogPath = resolve(process.env.CATALOG_DB ?? "data/t06/catalog.sqlite");
export const operations = ["new", "renewal", "expired_renewal", "upgrade"] as const;
export const quantityTierParameter = "К-во по тарифу";
export type Operation = typeof operations[number];

type DiscoveryFilters = { users?: number; operation?: Operation; months?: number; maxPrice?: number };

type OfferRow = {
  id: string;
  name: string;
  vendor: string;
  article: string;
  category: string;
  url: string;
  price: number | null;
  currency: string;
  available: number;
  users: number | null;
  license_operation: Operation | null;
  parameters: string;
  description: string;
};

// These Softline storefront cards were checked and request a quote despite a priced snapshot.
const quoteOnlyOfferIds = new Set(["100599", "48094"]);

function toOffer(row: OfferRow, descriptionLimit: number) {
  const price = quoteOnlyOfferIds.has(row.id) ? null : row.price;
  return {
    id: row.id, name: row.name, vendor: row.vendor, article: row.article,
    category: row.category, url: row.url, price, currency: row.currency,
    availableInCatalog: row.available === 1,
    maxUsers: row.users, licenseOperation: row.license_operation,
    parameters: JSON.parse(row.parameters) as Record<string, string[]>,
    description: row.description.slice(0, descriptionLimit),
  };
}

export type Offer = ReturnType<typeof toOffer>;

// The GstarCAD 2027 perpetual SKUs repeat the sales_notes quantity tier in their article.
export function articleQuantityBounds(article: string) {
  const match = /^g2027-(?:lt|std|pro)-(?:лок|сет)-пост-([1-9]\d{0,2})-([1-9]\d{0,2})$/iu.exec(article);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = Number(match[2]);
  return min <= max ? { min, max } : undefined;
}

export function quantityBounds(parameters: Record<string, string[]>) {
  const nodes = parameters["К-во узлов"];
  if (nodes?.length && nodes.every(value => /^[1-9]\d*$/u.test(value))) {
    const endpoints = nodes.map(Number);
    return { min: Math.min(...endpoints), max: Math.max(...endpoints) };
  }
  const bounds = parameters[quantityTierParameter];
  if (!bounds?.length) return undefined;
  const [min, max] = bounds.map(Number);
  return { min, max };
}

export function coversQuantityTier(parameters: Record<string, string[]>, quantity: number) {
  const bounds = quantityBounds(parameters);
  if (!bounds) return undefined;
  return quantity >= bounds.min && (bounds.max === undefined || quantity <= bounds.max);
}

export function rubleTotals(price: number | null, currency: string, quantity: number) {
  if (price === null || !/^(RUB|RUR)$/i.test(currency) || !Number.isSafeInteger(quantity) || quantity < 1) return;
  const unitKopecks = Math.round(price * 100);
  const totalKopecks = unitKopecks * quantity;
  if (unitKopecks < 1 || !Number.isSafeInteger(totalKopecks)) return;
  return { unitKopecks, totalKopecks };
}

export function normalizeSearch(value: string) {
  return value.toLowerCase().replaceAll("ё", "е");
}

// A named OS plus license facets is a product lookup. Other product names keep the full catalog searchable.
const astraNameOrEdition = /^(?:astra|linux|астра|линукс|special|common|edition|se|ce|воронеж\p{L}*|смоленск\p{L}*|орел|орл\p{L}*|усиленн\p{L}*|максимальн\p{L}*|базов\p{L}*)$/u;
const astraOfferFacet = /^(?:сервер\p{L}*|виртуальн\p{L}*|гостев\p{L}*|машин\p{L}*|вм|vm|рабоч\p{L}*|станци\p{L}*|верси\p{L}*|редакци\p{L}*|лицензи\p{L}*|техподдерж\p{L}*|поддерж\p{L}*|сертификат\p{L}*|ос|фстэк|box|[xх]86|\d+)$/u;

function searchExpression(query: string) {
  const words = normalizeSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  const astraOs = words.some((word, i) => word === "astra" && words[i + 1] === "linux" || word === "астра" && words[i + 1] === "линукс")
    && words.every(word => astraNameOrEdition.test(word) || astraOfferFacet.test(word));
  const clauses = new Set<string>();
  let preferredVendor: string | null = null;
  for (let i = 0; i < words.length && clauses.size < 12; i++) {
    const word = words[i];
    const next = words[i + 1];
    const spellsOutOs = word === "операционная" && words[i + 1] === "система";
    if (word === "mdaemon" && (next === "email" || next === "messaging") && words[i + 2] === "server") {
      clauses.add('("mdaemon email server" OR "mdaemon messaging server")');
      i += 2;
    } else if (astraOs && word === "астра" && next === "линукс") {
      clauses.add('"astra"*');
      clauses.add('"linux"*');
      i++;
    } else if (word === "континент" && next === "tls" && words[i + 2] === "vpn") {
      clauses.add('"континент"*');
      clauses.add('"tls"*');
      i += 2;
    } else if (word === "ос" || spellsOutOs) {
      clauses.add('("ос" OR "операционная система")');
      if (spellsOutOs) i++;
    } else if (word === "комплект" || word === "пакет" || word === "набор") {
      clauses.add('("комплект"* OR "пакет"* OR "набор"*)');
    } else if (/^актив(?:а|у|ом|е|ы|ов|ам|ами|ах)?$/u.test(word)) {
      clauses.add('"актив"*');
    } else if (word === "kaspersky" || word === "касперский" || word === "касперского") {
      clauses.add('("kaspersky"* OR "касперск"*)');
      preferredVendor = "«Лаборатория Касперского»";
    } else if (word === "защита" && (next === "почты" || next === "файлов")) {
      clauses.add('"защит"*');
      clauses.add(next === "почты" ? '"почт"*' : '"файл"*');
      i++;
    } else {
      clauses.add(`"${word}"*`);
    }
  }
  const academic = words.some(word => /^(академ|учеб|образоват|academic|education)/u.test(word));
  const mentionsLicense = words.some(word => /^(лицензи|licen)/u.test(word));
  const preferBaseLicense = (words.length === 1 ? !mentionsLicense : mentionsLicense) &&
    !words.some(word => /^(носител|медиа|дистрибутив|поддерж|техпод|сопровожд|продлен|обновлен|апгрейд|модул|media|support|renew|upgrade|addon)/u.test(word));
  return { match: [...clauses].join(" AND "), preferredVendor, words, academic, preferBaseLicense, astraOs };
}

export function openCatalog(path = catalogPath) {
  const db = new DatabaseSync(path, { readOnly: true });
  const offerColumns = `offers.*, CASE
    WHEN (operation IS NULL OR operation = 'new') AND (
      lower(name) LIKE '%cross-grade%' OR lower(name) LIKE '%crossgrade%' OR EXISTS (
        SELECT 1 FROM json_each(parameters, '$."Тип лицензии"')
        WHERE value IN ('Миграция', 'Обновление', 'Upg', 'Перекрестное обновление')
      )
    ) THEN 'upgrade' ELSE operation END AS license_operation`;
  // The feed lists smaller tiers in full and gives only endpoints for larger ranges.
  const quantityTierMatches = `CASE
    WHEN json_type(parameters, '$."К-во узлов"') IS NOT NULL THEN
      (SELECT :users BETWEEN min(CAST(value AS INTEGER)) AND max(CAST(value AS INTEGER))
        FROM json_each(parameters, '$."К-во узлов"'))
    WHEN json_type(parameters, '$."${quantityTierParameter}"') IS NOT NULL THEN
      :users >= CAST(json_extract(parameters, '$."${quantityTierParameter}"[0]') AS INTEGER)
      AND coalesce(:users <= CAST(json_extract(parameters, '$."${quantityTierParameter}"[1]') AS INTEGER), 1)
    END`;
  const durationMatches = `(:months IS NULL OR NOT EXISTS (
    SELECT 1 FROM json_each(parameters, '$."Срок действия"')
    WHERE value GLOB '[0-9]* мес.' AND CAST(value AS REAL) != :months
  ))`;
  const academicRank = `CASE WHEN :academic = 0 AND
    json_extract(parameters, '$."Тип организации"[0]') = 'Академическая' THEN 1 ELSE 0 END`;
  const baseLicenseRank = `CASE WHEN :preferBaseLicense = 1 AND available = 1 AND license_operation = 'new'
    AND json_extract(parameters, '$."Тип лицензии"[0]') = 'Полная версия' THEN 0 ELSE 1 END`;
  const astraProductMatches = `(:astraOs = 0 OR (offers.vendor = 'Группа Астра' AND
    (offers.name LIKE 'Astra Linux %' OR offers.name LIKE 'Сертификат техподдержки на ОС%Astra Linux%')))`;
  const findByIds = db.prepare(`SELECT ${offerColumns} FROM offers WHERE id = ?1 OR article = ?1 COLLATE NOCASE LIMIT 8`);
  const findText = db.prepare(`
    SELECT ${offerColumns} FROM offer_search JOIN offers ON offers.rowid = offer_search.rowid
    WHERE offer_search MATCH :match
      AND ${astraProductMatches}
      AND (:users IS NULL OR users >= :users OR (users IS NULL AND ${quantityTierMatches}))
      AND (:operation IS NULL OR license_operation = :operation)
      AND ${durationMatches}
    ORDER BY CASE WHEN :users IS NOT NULL THEN coalesce(users, :users) END,
      CASE WHEN offers.vendor = :preferredVendor THEN 0 ELSE 1 END,
      CASE WHEN offers.vendor = :preferredVendor AND available = 1 AND offers.name LIKE 'Kaspersky %' THEN 0 ELSE 1 END,
      ${academicRank}, ${baseLicenseRank}, bm25(offer_search, 10, 4, 3, 2, 1), available DESC LIMIT 6
  `);
  const findOptions = db.prepare(`
    SELECT ${offerColumns} FROM offer_search JOIN offers ON offers.rowid = offer_search.rowid
    WHERE offer_search MATCH :match AND available = 1
      AND ${astraProductMatches}
      AND (:maxPrice IS NULL OR (currency IN ('RUR', 'RUB') AND price <= :maxPrice))
      AND (:operation IS NULL OR license_operation IS NULL OR license_operation = :operation)
      AND ${durationMatches}
      AND (:users IS NULL OR users >= :users OR (users IS NULL AND coalesce(${quantityTierMatches}, 1)))
    ORDER BY CASE WHEN :users IS NOT NULL AND users = :users THEN 0 ELSE 1 END,
      ${academicRank}, ${baseLicenseRank}, bm25(offer_search, 14, 4, 6, 2, 1), price IS NULL LIMIT 6
  `);

  return {
    search(query: string, users?: number, operation?: Operation, months?: number) {
      const { match, preferredVendor, academic, preferBaseLicense, astraOs } = searchExpression(query);
      if (!match) return [];
      const rows = findText.all({ match, preferredVendor, academic: Number(academic), preferBaseLicense: Number(preferBaseLicense), astraOs: Number(astraOs),
        users: users ?? null, operation: operation ?? null, months: months ?? null }) as OfferRow[];
      const closest = users == null ? rows : rows.filter(row => (row.users ?? users) === (rows[0]?.users ?? users));
      return closest.map(row => toOffer(row, 650));
    },
    discover(queries: readonly string[], { users, operation, months, maxPrice }: DiscoveryFilters = {}) {
      const alternatives = queries.slice(0, 4).flatMap(query => {
        const { match, words, academic, preferBaseLicense, astraOs } = searchExpression(query);
        if (!match) return [];
        // Matching words in order in a product title adds relevance to the usual field weights.
        const phrase = words.length > 1 && words.length <= 4 ? words.map(word => `"${word}"*`).join(" + ") : "";
        const expression = phrase ? `(${match}) OR title:(${phrase})` : match;
        return [findOptions.all({ match: expression, academic: Number(academic), preferBaseLicense: Number(preferBaseLicense), astraOs: Number(astraOs),
          users: users ?? null, operation: operation ?? null, months: months ?? null, maxPrice: maxPrice ?? null }) as OfferRow[]];
      });
      const selected = new Map<string, OfferRow>();
      for (let rank = 0; rank < 6 && selected.size < 6; rank++) {
        for (const rows of alternatives) {
          const row = rows[rank];
          if (!row) continue;
          selected.set(row.id, row);
          if (selected.size === 6) break;
        }
      }
      return [...selected.values()].map(row => toOffer(row, 650));
    },
    find(idOrArticle: string) {
      return (findByIds.all(idOrArticle) as OfferRow[]).map(row => toOffer(row, 3200));
    },
    close() {
      db.close();
    },
  };
}
