"use client"

import { useRouter } from "next/navigation"
import { useId, useState, type FormEvent } from "react"
import { Alert, AlertDescription } from "./ui/alert"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"

type Notice = { type: "success" | "error"; text: string; source?: boolean }

const published = "Статья доступна помощнику по ключевым фразам."
const invalidSource = "Укажите ссылку на источник, которая начинается с https://."
const saveError = "Статью не удалось сохранить. Попробуйте ещё раз."

export function KnowledgeForm({ status }: { status?: string }) {
  const router = useRouter()
  const noticeId = useId()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(() => {
    if (status === "published") return { type: "success", text: published }
    if (status === "invalid") return { type: "error", text: "Проверьте длину полей, ключевые фразы и ссылку HTTPS." }
    return null
  })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const body = new URLSearchParams([...new FormData(form)].map(([key, value]) => [key, String(value)]))
    const source = (body.get("source") ?? "").trim()
    try {
      if (new URL(source).protocol !== "https:") throw new Error(invalidSource)
    } catch {
      setNotice({ type: "error", text: invalidSource, source: true })
      form.querySelector<HTMLInputElement>('[name="source"]')?.focus()
      return
    }
    body.set("source", source)
    setNotice(null)
    setPending(true)
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body,
      })
      const result: { id?: unknown; error?: unknown } | null = await response.json().catch(() => null)
      if (response.status !== 201 || typeof result?.id !== "string") {
        setNotice({ type: "error", text: typeof result?.error === "string" && result.error.trim() ? result.error : saveError })
        return
      }
      form.reset()
      setNotice({ type: "success", text: published })
      router.refresh()
    } catch {
      setNotice({ type: "error", text: saveError })
    } finally {
      setPending(false)
    }
  }

  return (
    <form action="/api/knowledge" method="post" onSubmit={submit} aria-busy={pending} className="grid gap-3">
      <div id={noticeId} aria-live="polite" aria-atomic="true">
        {notice && (
          <Alert role="none" variant={notice.type === "error" ? "destructive" : "default"}>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
      </div>
      <fieldset disabled={pending} className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Заголовок
            <Input name="title" minLength={3} maxLength={120} required className="min-h-11" />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            Ключевые фразы через запятую
            <Input name="keywords" minLength={2} maxLength={180} required className="min-h-11" />
          </label>
        </div>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Подтверждённый ответ
          <Textarea name="fact" minLength={8} maxLength={1200} required />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Ссылка на источник
          <Input
            name="source"
            type="url"
            placeholder="https://"
            maxLength={500}
            required
            className="min-h-11"
            aria-invalid={notice?.source || undefined}
            aria-describedby={notice?.source ? noticeId : undefined}
            onInvalid={event => {
              if (!event.currentTarget.validity.valueMissing) {
                setNotice({ type: "error", text: invalidSource, source: true })
              }
            }}
            onChange={() => { if (notice?.source) setNotice(null) }}
          />
        </label>
        <Button className="min-h-11 justify-self-start" type="submit">
          {pending ? "Сохраняем…" : "Добавить в базу"}
        </Button>
      </fieldset>
    </form>
  )
}
