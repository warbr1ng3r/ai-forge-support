import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeSearch, type Offer } from "./catalog.ts";

type Fact = {
  id: string;
  title: string;
  fact: string;
  source: string;
  kind: "catalog" | "manager";
  updatedAt: string;
};

const knowledgePhrase = (text: string) => normalizeSearch(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
let database: DatabaseSync | undefined;
function db() {
  if (database) return database;
  const path = resolve(process.env.SUPPORT_DB ?? "data/t06/support.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const opened = new DatabaseSync(path);
  opened.exec(`
    PRAGMA busy_timeout = 2000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS knowledge_facts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, keywords TEXT NOT NULL, fact TEXT NOT NULL,
      source TEXT NOT NULL, kind TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_events (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, details TEXT NOT NULL, createdAt TEXT NOT NULL
    );
  `);
  return database = opened;
}

export function lookupKnowledge(question: string) {
  // Product facts are retrieved only on a matching SKU. The catalog is authoritative for live commercial fields.
  const query = ` ${knowledgePhrase(question)} `;
  if (query.trim().length < 2) return [];
  return db().prepare(`SELECT id, title, fact, source, kind, updatedAt FROM knowledge_facts AS entry
    WHERE EXISTS (SELECT 1 FROM json_each(entry.keywords) AS keyword
      WHERE instr(?, ' ' || keyword.value || ' ') > 0)
    ORDER BY kind = 'manager' DESC, updatedAt DESC LIMIT 3`).all(query) as Fact[];
}

export function recordConsultation(tools: readonly string[], verified: readonly Offer[], complete: boolean) {
  const store = db();
  const time = new Date().toISOString();
  const upsert = store.prepare(`INSERT INTO knowledge_facts (id, title, keywords, fact, source, kind, updatedAt)
    VALUES (?, ?, ?, ?, ?, 'catalog', ?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, fact=excluded.fact, source=excluded.source, updatedAt=excluded.updatedAt`);
  const learned: string[] = [];
  for (const offer of verified) {
    if (!offer.url.startsWith("https://store.softline.ru/")) continue;
    const details = ["Редакция", "Назначение", "Тип лицензии", "Срок действия", "Язык интерфейса"].flatMap(key => {
      const values = offer.parameters[key];
      return values?.length ? [`${key} — ${values.join(", ").slice(0, 180)}`] : [];
    });
    if (!details.length) continue;
    upsert.run(`catalog:${offer.id}`, offer.name, JSON.stringify([offer.id]), details.join(". "), offer.url, time);
    learned.push(offer.id);
  }
  store.prepare("INSERT INTO support_events (action, details, createdAt) VALUES (?, ?, ?)").run(
    complete ? "Ответ завершён" : "Ответ прерван", JSON.stringify({ tools, learned }), time,
  );
}
