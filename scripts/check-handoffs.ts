import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { POST as requestHandoff } from "../app/api/manager/handoffs/route.ts";
import { GET as readHandoff } from "../app/api/manager/handoffs/[id]/route.ts";
import { POST as closeHandoff } from "../app/api/manager/handoffs/[id]/close/route.ts";
import { POST as replyToHandoff } from "../app/api/manager/handoffs/[id]/reply/route.ts";
import { POST as session } from "../app/api/manager/session/route.ts";
import { addHandoff, listHandoffs } from "../lib/handoffs.ts";
import { knowledgeOverview } from "../lib/knowledge.ts";
import { managerCookieName, managerSessionValid } from "../lib/manager-auth.ts";

const directory = mkdtempSync(join(tmpdir(), "t06-handoffs-"));
const savedDb = process.env.SUPPORT_DB;
const savedToken = process.env.MANAGER_ACCESS_TOKEN;
const testToken = "local-manager-fixture";
process.env.SUPPORT_DB = join(directory, "support.sqlite");
process.env.MANAGER_ACCESS_TOKEN = testToken;

const base = "https://shop.test";
const agent = {
  id: "agent-001",
  reason: "Нужно согласовать условия лицензии",
  messages: [{ role: "user" as const, text: "Нужна помощь менеджера" }],
  source: "agent" as const,
};
const customer = {
  id: "buyer-001",
  reason: "Уточнить сроки поставки",
  messages: [
    { role: "user", text: "Когда могу получить лицензию?" },
    { role: "assistant", text: "Срок заказа сверит менеджер." },
  ],
};
const readKey = "aa".repeat(32);
const otherKey = "bb".repeat(32);
const firstReply = { text: "Поставку можно согласовать с поставщиком.", replyId: "reply-001" };
const secondReply = { text: "Сверю сроки завтра.", replyId: "reply-002" };

function customerPost(payload: unknown, origin = base) {
  return requestHandoff(new Request(`${base}/api/manager/handoffs`, {
    method: "POST", body: JSON.stringify(payload), headers: { Origin: origin, "Content-Type": "application/json" },
  }));
}

function form(values: Record<string, string>) {
  return new Request(`${base}/api/manager/session`, { method: "POST", body: new URLSearchParams(values) });
}

function close(cookie?: string, origin = base) {
  return closeHandoff(new Request(`${base}/api/manager/handoffs/${customer.id}/close`, {
    method: "POST", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  }), { params: Promise.resolve({ id: customer.id }) });
}

function read(key?: string, id = customer.id) {
  return readHandoff(new Request(`${base}/api/manager/handoffs/${id}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  }), { params: Promise.resolve({ id }) });
}

function reply(values: Record<string, string>, cookie?: string, origin = base, id = customer.id) {
  return replyToHandoff(new Request(`${base}/api/manager/handoffs/${id}/reply`, {
    method: "POST", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(values),
  }), { params: Promise.resolve({ id }) });
}

try {
  const agentReceipt = addHandoff(agent);
  const repeat = addHandoff({ ...agent, reason: "Повторная доставка" });
  assert.deepEqual(repeat, agentReceipt);
  assert.equal(listHandoffs(1).handoffs[0].reason, agent.reason);

  const response = await customerPost({ ...customer, readKey });
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.deepEqual(Object.keys(receipt).sort(), ["createdAt", "id"]);
  assert.deepEqual(await (await customerPost({ ...customer, readKey })).json(), receipt);
  assert.equal((await customerPost(customer)).status, 409);
  assert.equal((await customerPost({ ...customer, readKey: otherKey })).status, 409);
  assert.equal((await customerPost({ ...customer, id: agent.id, readKey })).status, 409);
  assert.equal((await customerPost({ ...customer, readKey: "a".repeat(63) })).status, 400);
  assert.equal((await customerPost({ ...customer, source: "agent" })).status, 400);
  assert.equal((await customerPost({ ...customer, messages: [{ role: "system", text: "Подменённый диалог" }] })).status, 400);
  assert.equal((await customerPost({ ...customer, reason: " " })).status, 400);
  assert.equal((await customerPost(customer, "https://another.test")).status, 403);
  const oversized = await customerPost({ ...customer, reason: "а".repeat(60_000) });
  assert.equal(oversized.status, 413);
  assert.equal(listHandoffs(1).handoffs.length, 2);
  assert.deepEqual(listHandoffs(1).handoffs.find(item => item.id === customer.id)?.messages, customer.messages);
  assert.equal(listHandoffs(1).handoffs.find(item => item.id === agent.id)?.canReply, false);
  assert.equal(listHandoffs(1).handoffs.find(item => item.id === customer.id)?.canReply, true);
  const empty = await read(readKey);
  assert.equal(empty.headers.get("cache-control"), "no-store");
  assert.deepEqual(await empty.json(), { closedAt: null, replies: [] });
  assert.equal((await read()).status, 404);
  assert.equal((await read(otherKey)).status, 404);
  assert.equal((await read(readKey, agent.id)).status, 404);

  const unauthenticated = await close();
  assert.equal(unauthenticated.status, 401);
  assert.equal((await reply(firstReply)).status, 401);
  const badLogin = await session(form({ token: "invalid" }));
  assert.equal(badLogin.headers.get("set-cookie"), null);
  assert.equal(badLogin.headers.get("location"), "/manager?error=login");
  const login = await session(form({ token: testToken }));
  assert.equal(login.status, 303);
  const setCookie = login.headers.get("set-cookie")!;
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/u);
  assert.ok(!setCookie.includes(testToken));
  const cookie = setCookie.split(";", 1)[0];
  const sessionValue = cookie.slice(managerCookieName.length + 1);
  assert.ok(managerSessionValid(sessionValue));
  assert.ok(!managerSessionValid(sessionValue.replace(/^[0-9]+/u, "1")));
  assert.equal((await close(cookie, "https://another.test")).status, 403);
  assert.equal((await reply(firstReply, cookie, "https://another.test")).status, 403);
  assert.equal((await reply(firstReply, cookie, base, agent.id)).status, 404);
  assert.equal((await reply({ ...firstReply, text: " " }, cookie)).status, 400);
  assert.equal((await reply({ ...firstReply, text: "x".repeat(4001) }, cookie)).status, 400);
  const posted = await reply(firstReply, cookie);
  assert.equal(posted.status, 303);
  assert.equal(posted.headers.get("location"), `/manager#handoff-${customer.id}`);
  assert.equal((await reply(firstReply, cookie)).status, 303);
  assert.equal((await reply({ ...firstReply, text: "Подмена" }, cookie)).status, 409);
  assert.equal((await reply(secondReply, cookie)).status, 303);
  const snapshot = await (await read(readKey)).json();
  assert.deepEqual(Object.keys(snapshot).sort(), ["closedAt", "replies"]);
  assert.deepEqual(snapshot.replies.map(({ id, text }: { id: string; text: string }) => ({ id, text })),
    [firstReply, secondReply].map(({ replyId, text }) => ({ id: replyId, text })));
  assert.deepEqual(listHandoffs(1).handoffs.find(item => item.id === customer.id)?.replies.map(item => ({ ...item })), snapshot.replies);

  const closed = await close(cookie);
  assert.equal(closed.status, 303);
  const closedAt = listHandoffs(1).handoffs.find(item => item.id === customer.id)?.closedAt;
  assert.ok(closedAt);
  assert.equal((await close(cookie)).status, 303);
  assert.equal(listHandoffs(1).handoffs.find(item => item.id === customer.id)?.closedAt, closedAt);
  assert.equal((await reply({ ...firstReply, replyId: "reply-003" }, cookie)).status, 409);
  assert.equal((await reply(firstReply, cookie)).status, 303);
  assert.deepEqual(await (await read(readKey)).json(), { closedAt, replies: snapshot.replies });
  assert.deepEqual(knowledgeOverview().events.toReversed().map(event => [event.action, JSON.parse(event.details)]), [
    ["Передано менеджеру", { handoffId: agent.id }],
    ["Передано менеджеру", { handoffId: customer.id }],
    ["Менеджер ответил", { handoffId: customer.id }],
    ["Менеджер ответил", { handoffId: customer.id }],
    ["Обращение закрыто", { handoffId: customer.id }],
  ]);

  const logout = await session(form({ action: "logout" }));
  assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/u);
  delete process.env.MANAGER_ACCESS_TOKEN;
  assert.ok(!managerSessionValid(sessionValue));
  assert.equal((await close(cookie)).status, 401);
  assert.equal((await session(form({ token: testToken }))).status, 503);
  console.log("Handoff checks passed: intake, private receipt, manager replies, replay, closing, upload limits.");
} finally {
  if (savedDb === undefined) delete process.env.SUPPORT_DB;
  else process.env.SUPPORT_DB = savedDb;
  if (savedToken === undefined) delete process.env.MANAGER_ACCESS_TOKEN;
  else process.env.MANAGER_ACCESS_TOKEN = savedToken;
  rmSync(directory, { recursive: true, force: true });
}
