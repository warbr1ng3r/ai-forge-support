import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { recordSupportEvent } from "./knowledge.ts";

export const handoffId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u);
const handoffReadKey = z.string().regex(/^[a-f0-9]{64}$/u);

const message = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(6000),
});

const messages = z.array(message).min(1).max(16).refine(items =>
  items.some(item => item.role === "user") && items.reduce((length, item) => length + item.text.length, 0) <= 24_000);

export const customerHandoff = z.strictObject({
  id: handoffId,
  messages,
  reason: z.string().trim().min(1).max(500),
  readKey: handoffReadKey.optional(),
});

export const managerReply = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  replyId: handoffId,
});

const handoffInput = customerHandoff.extend({ source: z.enum(["customer", "agent"]) });
type HandoffInput = z.input<typeof handoffInput>;

type HandoffRow = {
  id: string;
  messages: string;
  reason: string;
  source: HandoffInput["source"];
  createdAt: string;
  closedAt: string | null;
  canReply: number;
};

type ReplyRow = { id: string; text: string; createdAt: string };

function openHandoffs() {
  const path = resolve(process.env.SUPPORT_DB ?? "data/t06/support.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY NOT NULL,
        messages TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('customer', 'agent')),
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS handoff_access (
        handoff_id TEXT PRIMARY KEY NOT NULL REFERENCES handoffs(id),
        read_key_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS handoff_replies (
        handoff_id TEXT NOT NULL REFERENCES handoff_access(handoff_id),
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (handoff_id, id)
      );
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function recordHandoff(action: string, handoffId: string) {
  try {
    recordSupportEvent(action, { handoffId });
  } catch {
    // The queue remains available if its separate activity log cannot be written.
  }
}

function hashReadKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function sameReadKey(stored: string | null, supplied: string | null) {
  if (stored === null || supplied === null) return stored === supplied;
  return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(supplied, "hex"));
}

export function addHandoff(input: HandoffInput): { id: string; createdAt: string } | undefined {
  const { id, messages, reason, source, readKey } = handoffInput.parse(input);
  const keyHash = readKey === undefined ? null : hashReadKey(readKey);
  const db = openHandoffs();
  try {
    db.exec("BEGIN IMMEDIATE");
    const inserted = db.prepare(`
      INSERT INTO handoffs (id, messages, reason, source, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(id, JSON.stringify(messages), reason, source, new Date().toISOString());
    if (inserted.changes === 1 && keyHash !== null) {
      db.prepare("INSERT INTO handoff_access (handoff_id, read_key_hash) VALUES (?, ?)").run(id, keyHash);
    }
    const saved = db.prepare(`
      SELECT h.created_at AS createdAt, a.read_key_hash AS keyHash FROM handoffs h
      LEFT JOIN handoff_access a ON h.id = a.handoff_id WHERE h.id = ?
    `).get(id) as { createdAt: string; keyHash: string | null };
    db.exec("COMMIT");
    if (!sameReadKey(saved.keyHash, keyHash)) return;
    if (inserted.changes === 1) recordHandoff("Передано менеджеру", id);
    return { id, createdAt: saved.createdAt };
  } finally {
    db.close();
  }
}

function replyQuery(db: DatabaseSync) {
  return db.prepare(`
    SELECT id, text, created_at AS createdAt FROM handoff_replies WHERE handoff_id = ? ORDER BY rowid
  `);
}

export function listHandoffs(page: number) {
  const pageSize = 20;
  const db = openHandoffs();
  try {
    const rows = db.prepare(`
      SELECT id, messages, reason, source, created_at AS createdAt, closed_at AS closedAt,
        EXISTS (SELECT 1 FROM handoff_access WHERE handoff_id = handoffs.id) AS canReply
      FROM handoffs
      ORDER BY closed_at IS NULL DESC, created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(pageSize + 1, (page - 1) * pageSize) as HandoffRow[];
    const replies = replyQuery(db);
    return {
      hasNext: rows.length > pageSize,
      handoffs: rows.slice(0, pageSize).map(row => ({
        ...row,
        messages: JSON.parse(row.messages) as HandoffInput["messages"],
        canReply: Boolean(row.canReply),
        replies: replies.all(row.id) as ReplyRow[],
      })),
    };
  } finally {
    db.close();
  }
}

export function readHandoffReplies(id: string, key: string) {
  if (!handoffId.safeParse(id).success || !handoffReadKey.safeParse(key).success) return;
  const db = openHandoffs();
  try {
    const handoff = db.prepare(`
      SELECT h.closed_at AS closedAt, a.read_key_hash AS keyHash FROM handoffs h
      JOIN handoff_access a ON h.id = a.handoff_id WHERE h.id = ?
    `).get(id) as { closedAt: string | null; keyHash: string } | undefined;
    if (!handoff || !sameReadKey(handoff.keyHash, hashReadKey(key))) return;
    return { closedAt: handoff.closedAt, replies: replyQuery(db).all(id) as ReplyRow[] };
  } finally {
    db.close();
  }
}

export function replyToHandoff(id: string, input: z.input<typeof managerReply>) {
  if (!handoffId.safeParse(id).success) return "notFound";
  const { text, replyId } = managerReply.parse(input);
  const db = openHandoffs();
  try {
    const inserted = db.prepare(`
      INSERT INTO handoff_replies (handoff_id, id, text, created_at)
      SELECT h.id, ?, ?, ? FROM handoffs h JOIN handoff_access a ON h.id = a.handoff_id
      WHERE h.id = ? AND h.closed_at IS NULL
      ON CONFLICT(handoff_id, id) DO NOTHING
    `).run(replyId, text, new Date().toISOString(), id);
    if (inserted.changes === 1) {
      recordHandoff("Менеджер ответил", id);
      return "saved";
    }
    const existing = db.prepare("SELECT text FROM handoff_replies WHERE handoff_id = ? AND id = ?")
      .get(id, replyId);
    if (existing) return existing.text === text ? "saved" : "conflict";
    return db.prepare("SELECT 1 FROM handoff_access WHERE handoff_id = ?").get(id) ? "closed" : "notFound";
  } finally {
    db.close();
  }
}

export function closeHandoff(id: string) {
  if (!handoffId.safeParse(id).success) return false;
  const db = openHandoffs();
  try {
    const query = db.prepare("UPDATE handoffs SET closed_at = ? WHERE id = ? AND closed_at IS NULL");
    if (query.run(new Date().toISOString(), id).changes === 1) {
      recordHandoff("Обращение закрыто", id);
      return true;
    }
    return db.prepare("SELECT 1 FROM handoffs WHERE id = ?").get(id) !== undefined;
  } finally {
    db.close();
  }
}
