import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KnowledgeForm } from "@/components/knowledge-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { knowledgeOverview } from "@/lib/knowledge";
import { managerCookieName, managerSessionValid } from "@/lib/manager-auth";

export const runtime = "nodejs";

const formatTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!managerSessionValid((await cookies()).get(managerCookieName)?.value)) redirect("/manager");
  const { facts, events } = knowledgeOverview();
  const { status } = await searchParams;
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="chat-column space-y-5 py-5 sm:py-8">
        <Link href="/manager" className="text-sm font-medium underline underline-offset-4">К обращениям</Link>
        <h2 className="text-2xl font-semibold tracking-tight">База знаний</h2>
        <Card>
          <CardHeader><CardTitle>Добавить проверенную статью</CardTitle></CardHeader>
          <CardContent>
            <KnowledgeForm status={status} />
          </CardContent>
        </Card>
        <section aria-labelledby="knowledge-facts" className="space-y-3">
          <h3 id="knowledge-facts" className="text-lg font-semibold">Последние факты</h3>
          {facts.length === 0 && <p className="text-sm text-muted-foreground">Факты появятся после подтверждения позиции или добавления статьи.</p>}
          {facts.map(entry => (
            <Card key={entry.id}>
              <CardContent className="space-y-2 py-3">
                <Badge variant="outline">{entry.kind === "catalog" ? "Из подтверждённой карточки" : "Добавлено менеджером"}</Badge>
                <p className="font-semibold wrap-anywhere">{entry.title}</p>
                <p className="text-sm whitespace-pre-wrap wrap-anywhere">{entry.fact}</p>
                <a className="text-sm underline underline-offset-4" href={entry.source} target="_blank" rel="noreferrer">Источник</a>
              </CardContent>
            </Card>
          ))}
        </section>
        <section aria-labelledby="knowledge-log" className="space-y-2">
          <h3 id="knowledge-log" className="text-lg font-semibold">Журнал действий</h3>
          <ul className="divide-y rounded-lg border">
            {events.map(event => {
              const { tools = [], learned = [], offerId, count, handoffId } = JSON.parse(event.details) as {
                tools?: string[]; learned?: string[]; offerId?: string; count?: number; handoffId?: string;
              };
              return (
                <li key={event.id} className="grid gap-1 px-3 py-2 text-sm">
                  <p>{event.action} <time dateTime={event.createdAt} className="text-muted-foreground">· {formatTime.format(new Date(event.createdAt))} МСК</time></p>
                  {tools.length > 0 && <p className="text-xs text-muted-foreground wrap-anywhere">{tools.join(", ")}</p>}
                  {learned.length > 0 && <p className="text-xs text-muted-foreground">В базу внесены факты по позициям {learned.join(", ")}</p>}
                  {offerId && <p className="text-xs text-muted-foreground">Позиция {offerId} · {count} ед.</p>}
                  {handoffId && <p className="text-xs text-muted-foreground wrap-anywhere">Обращение {handoffId}</p>}
                </li>
              );
            })}
            {events.length === 0 && <li className="p-3 text-sm text-muted-foreground">Пока действий нет.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
