import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const managerCookieName = "support_manager";
const sessionSeconds = 8 * 60 * 60;

function managerToken() {
  const token = process.env.MANAGER_ACCESS_TOKEN;
  return token?.trim() ? token : undefined;
}

export function managerAccessConfigured() {
  return managerToken() !== undefined;
}

function signature(token: string, value: string) {
  return createHmac("sha256", token).update(`support-manager-session/v1:${value}`).digest();
}

export function signInManager(entered: string) {
  const token = managerToken();
  if (!token) return undefined;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(token), digest(entered))) return undefined;
  const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
  const value = `${expires}.${randomBytes(16).toString("hex")}`;
  return `${value}.${signature(token, value).toString("hex")}`;
}

export function managerSessionValid(signedCookie: string | undefined): boolean {
  const token = managerToken();
  const match = signedCookie?.match(/^(\d{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/u);
  if (!token || !match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const value = `${match[1]}.${match[2]}`;
  return timingSafeEqual(signature(token, value), Buffer.from(match[3], "hex"));
}

export function managerCookieFrom(request: Request) {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [name, value] = part.trim().split("=", 2);
    if (name === managerCookieName) return value;
  }
}

function secureRequest(request: Request) {
  return new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

export function managerSessionCookie(request: Request, value: string) {
  return `${managerCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? sessionSeconds : 0}` +
    (secureRequest(request) ? "; Secure" : "");
}

export function managerRequestOriginAllowed(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return origin === `${secureRequest(request) ? "https:" : url.protocol}//${host}`;
}

export async function readLimitedText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) {
    void request.body?.cancel().catch(() => {});
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
