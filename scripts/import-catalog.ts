import { createReadStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SaxesParser } from "saxes";
import { catalogPath, normalizeSearch, quantityTierParameter, type Operation } from "../lib/catalog.ts";
import { catalogPriceUnit } from "../lib/store-faq.ts";

const input = process.argv[2] ?? "data/t06/raw/catalog.xml";
const temporary = `${catalogPath}.${process.pid}.tmp`;
await mkdir(dirname(catalogPath), { recursive: true });
const db = new DatabaseSync(temporary);
const started = performance.now();
const categories = new Map<string, string>();
const stack: { name: string; attributes: Record<string, string>; text: string }[] = [];
let offer: {
  id: string; available: boolean; fields: Record<string, string>;
  parameters: Record<string, string[]>;
} | undefined;
let count = 0;

function clean(text: string) {
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|quot|laquo|raquo|mdash|ndash|#160);/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function licenseOperation(name: string, parameters: Record<string, string[]>): Operation | null {
  const licenseTypes = (parameters["Тип лицензии"] ?? []).map(normalizeSearch);
  const label = [normalizeSearch(name), ...licenseTypes].join(" ");
  if (/продлен\w*\s+просрочен|просроченн\p{L}*\s+подписк/u.test(label)) return "expired_renewal";
  if (/продлен|renewal/u.test(label)) return "renewal";
  if (/апгрейд|upgrade|переход с/u.test(label)) return "upgrade";
  if (licenseTypes.includes("полная версия") || /лицензи|подписк|license|subscription/u.test(label)) return "new";
  return null;
}

function userCount(name: string, parameters: Record<string, string[]>): number | null {
  const values = parameters["К-во пользователей до"] ??
    Array.from(name.matchAll(/(?:^|[^\p{L}\p{N}])пакет\s+([1-9]\d*)\s+рабочих\s+мест(?!\p{L})|,\s*([1-9]\d*)\s+seats$/giu),
      match => match[1] ?? match[2]);
  const counts = [...new Set(values)];
  if (counts.length !== 1 || !/^[1-9]\d*$/.test(counts[0])) return null;
  const count = Number(counts[0]);
  return Number.isSafeInteger(count) ? count : null;
}

try {
  db.exec(`
    CREATE TABLE offers (
      id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, vendor TEXT NOT NULL, article TEXT NOT NULL,
      category TEXT NOT NULL, url TEXT NOT NULL, price REAL, currency TEXT NOT NULL,
      available INTEGER NOT NULL, users INTEGER, operation TEXT,
      parameters TEXT NOT NULL, description TEXT NOT NULL
    );
    CREATE INDEX offers_article ON offers(article COLLATE NOCASE);
    CREATE VIRTUAL TABLE offer_search USING fts5(
      title, vendor, category, attributes, description, tokenize = 'unicode61'
    );
    BEGIN;
  `);
  const add = db.prepare("INSERT INTO offers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const index = db.prepare("INSERT INTO offer_search(rowid, title, vendor, category, attributes, description) VALUES (?, ?, ?, ?, ?, ?)");
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", tag => {
    stack.push({ name: tag.name, attributes: tag.attributes, text: "" });
    if (tag.name === "offer" && stack.at(-2)?.name === "offers") {
      offer = {
        id: tag.attributes.id, available: tag.attributes.available === "true",
        fields: Object.create(null), parameters: Object.create(null),
      };
    }
  });
  const appendText = (text: string) => {
    const field = stack.at(-1);
    if (field && (stack.at(-2)?.name === "offer" || field.name === "category")) field.text += text;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => {
    const field = stack.pop()!;
    const parent = stack.at(-1)?.name;
    if (field.name === "category" && parent === "categories") {
      categories.set(field.attributes.id, field.text.trim());
    }
    if (!offer) return;
    if (parent === "offer") {
      if (field.name === "param") {
        const label = field.attributes.name?.trim();
        const value = clean(field.text);
        if (label && value && value !== "другое или отсутствует") {
          (offer.parameters[label] ??= []).push(value);
        }
      } else {
        offer.fields[field.name] = field.text.trim();
      }
    }
    if (field.name !== "offer" || parent !== "offers") return;
    const { id, available, parameters, fields } = offer;
    const { name, vendor = "", vendorCode = "", categoryId, url, currencyId } = fields;
    if (!id || !name || !url || !currencyId) throw new Error(`Неполная позиция каталога ${id}`);
    const category = categories.get(categoryId) ?? "";
    const description = clean(fields.description ?? "").slice(0, 8000);
    const price = Number(fields.price);
    const users = userCount(name, parameters);
    if (catalogPriceUnit(name) || /(?:по количеству|количество) (?:рабочих станций|пользователей)(?!\p{L})/iu.test(name)) {
      const tier = /^кол-во от ([1-9]\d*)(?: до ([1-9]\d*))? шт\.?$/iu.exec(clean(fields.sales_notes ?? ""));
      if (tier && Number.isSafeInteger(Number(tier[2] ?? tier[1])) && (!tier[2] || Number(tier[1]) <= Number(tier[2]))) {
        parameters[quantityTierParameter] = tier[2] ? [tier[1], tier[2]] : [tier[1]];
      }
    }
    const operation = licenseOperation(name, parameters);
    const productUrl = new URL(url);
    if (productUrl.protocol !== "https:" || productUrl.hostname !== "store.softline.ru") {
      throw new Error(`Неизвестный источник позиции ${id}`);
    }
    const row = add.run(id, name, vendor, vendorCode, category, url,
      Number.isFinite(price) && price > 0 ? price : null, currencyId,
      Number(available), users, operation, JSON.stringify(parameters), description);
    index.run(row.lastInsertRowid, normalizeSearch(`${name} ${vendorCode}`), normalizeSearch(vendor),
      normalizeSearch(category), normalizeSearch(Object.values(parameters).flat().join(" ")),
      normalizeSearch(description));
    count++;
    offer = undefined;
  });

  for await (const chunk of createReadStream(input, { encoding: "utf8" })) parser.write(chunk);
  parser.close();
  if (count === 0) throw new Error("Каталог не содержит позиций");
  db.exec("INSERT INTO offer_search(offer_search) VALUES ('optimize'); COMMIT;");
} catch (error) {
  db.close();
  await rm(temporary, { force: true });
  throw error;
}

db.close();
try {
  await rename(temporary, catalogPath);
} finally {
  await rm(temporary, { force: true });
}
console.log(JSON.stringify({ offers: count, categories: categories.size, seconds: (performance.now() - started) / 1000 }));
