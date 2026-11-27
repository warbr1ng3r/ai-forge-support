"use client"

import { LayersIcon } from "lucide-react"
import { useState } from "react"

import { Suggestions } from "@/components/suggestions"
import { Textarea } from "@/components/ui/textarea"

export function Chat() {
  const [draft, setDraft] = useState("")
  return (
    <main className="mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto">
      <section className="chat-column pt-5 pb-4 sm:pt-10 sm:pb-5 lg:pt-16" aria-labelledby="welcome-title">
        <div className="grid min-w-0 overflow-hidden rounded-2xl border bg-card lg:grid-cols-[0.95fr_1.05fr]">
          <div className="flex flex-col justify-center gap-3 bg-[#1e2c52] p-5 text-[#f3f5ff] sm:gap-4 sm:p-8 dark:bg-[#253657]">
            <LayersIcon aria-hidden="true" className="size-6 text-[#c8c5fb]" />
            <h2 id="welcome-title" className="max-w-[16ch] text-2xl/[1.08] font-semibold tracking-tight sm:text-4xl lg:text-[2.65rem]">
              Подберите ПО под вашу задачу
            </h2>
            <p className="max-w-[38ch] text-sm/relaxed text-[#dde4fa] sm:text-[15px]">
              Назовите продукт или опишите потребность. Помощник сверит варианты лицензий по каталогу Softline.
            </p>
          </div>
          <div className="min-w-0 p-3 sm:p-5">
            <Suggestions onSelect={setDraft} />
          </div>
        </div>
      </section>
      <div className="chat-column mt-auto grid gap-2 pb-4">
        <Textarea
          aria-label="Ваш запрос"
          aria-describedby="chat-status"
          placeholder="Напишите, что вам нужно…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p id="chat-status" className="text-xs text-muted-foreground">
          Отправка запросов станет доступна после подключения помощника.
        </p>
      </div>
    </main>
  )
}
