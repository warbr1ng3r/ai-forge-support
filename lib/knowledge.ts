import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
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
export const knowledgeEntry = z.object({
  title: z.string().trim().min(3).max(120),
  keywords: z.string().trim().min(2).max(180)
    .transform(value => [...new Set(value.split(",").map(knowledgePhrase).filter(word => word.length >= 2))])
    .pipe(z.array(z.string().max(60)).min(1).max(6)),
  fact: z.string().trim().min(8).max(1200),
  source: z.url({ protocol: /^https$/, normalize: true }).max(500)
    .refine(value => { const url = new URL(value); return !url.username && !url.password; }),
});

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

export function publishKnowledge(value: z.output<typeof knowledgeEntry>) {
  const store = db();
  const id = randomUUID();
  const now = new Date().toISOString();
  store.exec("BEGIN IMMEDIATE");
  try {
    store.prepare("INSERT INTO knowledge_facts VALUES (?, ?, ?, ?, ?, 'manager', ?)")
      .run(id, value.title, JSON.stringify(value.keywords), value.fact, value.source, now);
    store.prepare("INSERT INTO support_events (action, details, createdAt) VALUES (?, ?, ?)")
      .run("Опубликована статья", JSON.stringify({ id }), now);
    store.exec("COMMIT");
    return id;
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

export function recordSupportEvent(action: string, details: { offerId?: string; count?: number; handoffId?: string }) {
  db().prepare("INSERT INTO support_events (action, details, createdAt) VALUES (?, ?, ?)")
    .run(action, JSON.stringify(details), new Date().toISOString());
}

export function knowledgeOverview() {
  const store = db();
  return {
    facts: store.prepare("SELECT id, title, fact, source, kind, updatedAt FROM knowledge_facts ORDER BY updatedAt DESC LIMIT 30").all() as Fact[],
    events: store.prepare("SELECT id, action, details, createdAt FROM support_events ORDER BY id DESC LIMIT 20").all() as Array<{
      id: number; action: string; details: string; createdAt: string;
    }>,
  };
}
