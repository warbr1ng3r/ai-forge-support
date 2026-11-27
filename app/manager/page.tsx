import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { TextPart } from "@/components/parts/text-part";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listHandoffs } from "@/lib/handoffs";
import { managerAccessConfigured, managerCookieName, managerSessionValid } from "@/lib/manager-auth";

export const metadata: Metadata = {
  title: "Очередь обращений",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const time = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow",
});

function SignIn({ invalid }: { invalid: boolean }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle><h2 className="text-xl font-semibold">Менеджерский раздел</h2></CardTitle>
          <CardDescription>Войдите, чтобы открыть очередь обращений.</CardDescription>
        </CardHeader>
        <CardContent>
          {managerAccessConfigured() ? (
            <form action="/api/manager/session" method="post" autoComplete="off" className="space-y-4">
              {invalid && <Alert variant="destructive"><AlertDescription>Проверьте ключ доступа.</AlertDescription></Alert>}
              <div className="space-y-2">
                <label htmlFor="manager-token" className="block text-sm font-medium">Ключ доступа</label>
                <Input id="manager-token" name="token" type="password" autoComplete="off" maxLength={1024} required className="h-11" />
              </div>
              <Button type="submit" size="lg" className="min-h-11 w-full">Войти</Button>
            </form>
          ) : <Alert><AlertDescription>Доступ менеджера пока не настроен.</AlertDescription></Alert>}
          <Link href="/" className={buttonVariants({ variant: "link", className: "mt-3 min-h-11 px-0" })}>К чату</Link>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function ManagerPage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const cookie = (await cookies()).get(managerCookieName)?.value;
  if (!managerSessionValid(cookie)) return <SignIn invalid={params.error === "login"} />;

  const page = typeof params.page === "string" && /^[1-9]\d{0,5}$/u.test(params.page) ? Number(params.page) : 1;
  const { handoffs, hasNext } = listHandoffs(page);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Очередь обращений</h2>
          <nav aria-label="Менеджерский раздел" className="flex flex-wrap gap-2">
            <Link href="/manager/knowledge" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>База знаний</Link>
            <Link href="/" className={buttonVariants({ variant: "ghost", className: "min-h-11" })}>К чату</Link>
            <form action="/api/manager/session" method="post">
              <input type="hidden" name="action" value="logout" />
              <Button type="submit" variant="ghost" className="min-h-11">Выйти</Button>
            </form>
          </nav>
        </div>
        {handoffs.length === 0 ? (
          <Card>
            <Empty className="p-6 sm:p-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><InboxIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{page === 1 ? "Обращений пока нет" : "На этой странице обращений нет"}</EmptyTitle>
                {page === 1 && <EmptyDescription>Здесь появятся диалоги, переданные из чата.</EmptyDescription>}
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          <ul className="space-y-3">
            {handoffs.map(handoff => (
              <li key={handoff.id} id={`handoff-${handoff.id}`} className="scroll-mt-4">
                <Card size="sm">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={handoff.closedAt ? "outline" : "secondary"}>{handoff.closedAt ? "Закрыто" : "Открыто"}</Badge>
                      <span className="text-xs text-muted-foreground">{handoff.source === "customer" ? "Передал покупатель" : "Передал помощник"}</span>
                    </div>
                    <CardTitle><h3 className="wrap-anywhere">{handoff.reason}</h3></CardTitle>
                    <CardDescription className="wrap-anywhere">
                      <time dateTime={handoff.createdAt}>{time.format(new Date(handoff.createdAt))} МСК</time>
                      <span> · {handoff.id}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Collapsible>
                      <div className="flex flex-wrap items-center gap-2">
                        <CollapsibleTrigger render={<Button type="button" variant="outline" className="min-h-11" />}>
                          Диалог
                        </CollapsibleTrigger>
                        {handoff.closedAt ? (
                          <p className="text-xs text-muted-foreground">
                            Закрыто <time dateTime={handoff.closedAt}>{time.format(new Date(handoff.closedAt))} МСК</time>
                          </p>
                        ) : (
                          <form action={`/api/manager/handoffs/${handoff.id}/close`} method="post">
                            <Button type="submit" variant="ghost" className="min-h-11">Закрыть обращение</Button>
                          </form>
                        )}
                      </div>
                      <CollapsibleContent>
                        <ol className="mt-3 space-y-2">
                          {handoff.messages.map((message, index) => (
                            <li key={index} className="min-w-0 rounded-xl border border-border bg-background p-3">
                              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                                {message.role === "user" ? "Покупатель" : "Помощник"}
                              </p>
                              {message.role === "assistant" ? <TextPart part={message} /> : (
                                <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </CollapsibleContent>
                    </Collapsible>
                    {handoff.replies.length > 0 && (
                      <ol className="space-y-2" aria-label="Отправленные ответы">
                        {handoff.replies.map(reply => (
                          <li key={reply.id} className="min-w-0 rounded-xl border border-border bg-background p-3">
                            <p className="text-xs font-semibold text-muted-foreground">
                              Менеджер · <time dateTime={reply.createdAt}>{time.format(new Date(reply.createdAt))} МСК</time>
                            </p>
                            <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-sm">{reply.text}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                    {handoff.canReply && !handoff.closedAt && (
                      <form action={`/api/manager/handoffs/${handoff.id}/reply${page > 1 ? `?page=${page}` : ""}`} method="post" className="grid gap-2">
                        <input type="hidden" name="replyId" value={randomUUID()} />
                        <label className="grid gap-1 text-sm">
                          Ответ клиенту
                          <Textarea name="text" maxLength={4000} rows={2} required className="rounded-xl border-border bg-background" />
                        </label>
                        <Button type="submit" variant="outline" size="sm" className="min-h-11 justify-self-start">
                          Отправить ответ
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasNext) && (
          <nav aria-label="Страницы обращений" className="flex flex-wrap items-center justify-between gap-2">
            {page > 1 && <Link href={`/manager?page=${page - 1}`} className={buttonVariants({ variant: "outline", className: "min-h-11" })}>Назад</Link>}
            {hasNext && <Link href={`/manager?page=${page + 1}`} className={buttonVariants({ variant: "outline", className: "ml-auto min-h-11" })}>Следующая страница</Link>}
          </nav>
        )}
      </div>
    </main>
  );
}
