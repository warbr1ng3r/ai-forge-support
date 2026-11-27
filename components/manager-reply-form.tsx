"use client"

import { useRouter } from "next/navigation"
import { useId, useRef, useState, type FormEvent } from "react"
import { Alert, AlertDescription } from "./ui/alert"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"

const emptyReply = "Введите ответ от 1 до 4000 символов."
const submissionError = "Не удалось отправить ответ. Попробуйте ещё раз."
type Notice = { text: string; error: boolean; field?: boolean }

export function ManagerReplyForm({ action, initialReplyId }: { action: string; initialReplyId: string }) {
  const router = useRouter()
  const noticeId = useId()
  const replyField = useRef<HTMLTextAreaElement>(null)
  const sending = useRef(false)
  const [replyId, setReplyId] = useState(initialReplyId)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<Notice>()

  function showEmptyReply() {
    setNotice({ text: emptyReply, error: true, field: true })
    replyField.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const form = event.currentTarget
    const text = replyField.current?.value.trim() ?? ""
    if (!text) return showEmptyReply()

    sending.current = true
    setPending(true)
    setNotice(undefined)
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams({ replyId, text }),
      })
      const result: { id?: unknown; error?: unknown } | null = await response.json().catch(() => null)
      if (response.status !== 201 || result?.id !== replyId) {
        setNotice({ text: typeof result?.error === "string" ? result.error : submissionError, error: true })
        return
      }
      setReplyId(crypto.randomUUID())
      form.reset()
      setNotice({ text: "Ответ отправлен клиенту.", error: false })
      router.refresh()
    } catch {
      setNotice({ text: submissionError, error: true })
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  return (
    <form action={action} method="post" onSubmit={submit} aria-busy={pending} className="grid gap-2">
      <input type="hidden" name="replyId" value={replyId} />
      <label className="grid gap-1 text-sm">
        Ответ клиенту
        <Textarea
          ref={replyField}
          name="text"
          maxLength={4000}
          rows={2}
          required
          readOnly={pending}
          aria-invalid={notice?.field || undefined}
          aria-describedby={notice?.field ? noticeId : undefined}
          onInvalid={event => { event.preventDefault(); showEmptyReply() }}
          onChange={() => { if (notice?.field) setNotice(undefined) }}
          className="rounded-xl border-border bg-background"
        />
      </label>
      <div id={noticeId} aria-live="polite">
        {notice && (
          <Alert role="none" variant={notice.error ? "destructive" : "default"}>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
      </div>
      <Button type="submit" variant="outline" size="sm" className="min-h-11 justify-self-start" disabled={pending}>
        {pending ? "Отправляем…" : "Отправить ответ"}
      </Button>
    </form>
  )
}
