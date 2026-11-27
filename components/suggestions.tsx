"use client"

import { ArrowRightIcon, FileTextIcon, PackageCheckIcon, ShieldCheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

const suggestions = [
  {
    label: "Подобрать лицензию",
    prompt: "Нужен MDaemon на 50 пользователей. Какую лицензию выбрать?",
    example: "MDaemon на 50 пользователей",
    icon: PackageCheckIcon,
  },
  {
    label: "Найти решение",
    prompt: "Что подойдёт для защиты почты и файлов компании на 50 сотрудников?",
    example: "Защита почты и файлов",
    icon: ShieldCheckIcon,
  },
  {
    label: "Уточнить условия заказа",
    prompt: "Как юрлицу оплатить заказ?",
    example: "Оплата заказа юрлицом",
    icon: FileTextIcon,
  },
]

export function Suggestions({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid gap-2 max-sm:[@media(max-height:650px)]:gap-1.5 sm:gap-3" aria-label="Примеры запросов">
      {suggestions.map(({ label, prompt, example, icon: Icon }) => (
        <Button key={label} variant="outline" size="lg" className="h-auto min-h-14 w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left whitespace-normal max-sm:[@media(max-height:650px)]:py-1.5 sm:px-4" onClick={() => onSelect(prompt)}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Icon aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm leading-snug font-semibold">{label}</span>
            <span className="text-xs leading-relaxed font-normal text-muted-foreground sm:text-sm">{example}</span>
          </span>
          <ArrowRightIcon className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      ))}
    </div>
  )
}
