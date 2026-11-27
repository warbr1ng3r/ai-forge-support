"use client"

import { type UIMessage } from "ai"
import { UserRoundIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"

type HandoffReceipt = { id: string; readKey: string }
type HandoffUpdate = {
  closedAt: string | null
  replies: { id: string; text: string; createdAt: string }[]
}

const receiptStorageKey = "support-handoff-receipts"

export function useHandoffReceipts() {
  const [receipts, setReceipts] = useState<HandoffReceipt[]>([])

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(receiptStorageKey) ?? "[]")
      if (Array.isArray(stored)) {
        setReceipts(stored.filter((value): value is HandoffReceipt =>
          !!value && typeof value.id === "string" && /^chat-[A-Za-z0-9_-]{1,95}$/u.test(value.id)
          && typeof value.readKey === "string" && /^[a-f0-9]{64}$/u.test(value.readKey)))
      }
    } catch {
      // The current tab can still show replies when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    if (!receipts.length) return
    try {
      sessionStorage.setItem(receiptStorageKey, JSON.stringify(receipts))
    } catch {
      // The current tab can still show replies when storage is unavailable.
    }
  }, [receipts])

  function addReceipt(receipt: HandoffReceipt) {
    setReceipts(current => current.some(item => item.id === receipt.id) ? current : [...current, receipt])
  }

  return { receipts, addReceipt }
}

export function HandoffReplies({ receipt, focus }: { receipt: HandoffReceipt; focus: boolean }) {
  const { id, readKey } = receipt
  const [update, setUpdate] = useState<HandoffUpdate>()
  const [error, setError] = useState<"retrying" | "unavailable">()
  const receiptRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (focus) receiptRef.current?.focus()
  }, [focus])

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined

    async function refresh() {
      try {
        const response = await fetch(`/api/manager/handoffs/${id}`, {
          headers: { Authorization: `Bearer ${readKey}` },
          cache: "no-store",
          signal: controller.signal,
        })
        if (response.status === 404) {
          setError("unavailable")
          return
        }
        if (!response.ok) throw new Error("Не удалось обновить обращение")
        const latest: HandoffUpdate = await response.json()
        if (controller.signal.aborted) return
        setUpdate(latest)
        setError(undefined)
        if (latest.closedAt) return
      } catch {
        if (!controller.signal.aborted) setError("retrying")
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 2000)
    }

    void refresh()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [id, readKey])

  return (
    <Card size="sm" role="group" aria-label={`Обращение ${id}`}>
      <CardContent className="space-y-3">
        <p ref={receiptRef} role="status" tabIndex={-1} className="wrap-anywhere text-sm text-muted-foreground">
          {update?.closedAt ? "Обращение закрыто." : "Обращение передано в очередь менеджера демо."} Номер обращения {id}.
        </p>
        <div aria-live="polite" aria-relevant="additions text">
          {update?.replies.length ? (
            <ol aria-label="Ответы менеджера" className="space-y-2">
              {update.replies.map(reply => (
                <li key={reply.id} className="rounded-xl border bg-background p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Менеджер</p>
                  <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-sm">{reply.text}</p>
                </li>
              ))}
            </ol>
          ) : update?.closedAt || error === "unavailable" ? null : <p className="text-sm text-muted-foreground">Ожидаем ответ менеджера.</p>}
        </div>
        {error && (
          <p role="status" className="text-sm text-muted-foreground">
            {error === "unavailable" ? "Обновление этого обращения недоступно." : "Не удалось обновить обращение. Повторяем запрос."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ChatHandoff({ requestId, messages, onSent }: {
  requestId: string
  messages: UIMessage[]
  onSent: (receipt: HandoffReceipt) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [reason, setReason] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const readKeyRef = useRef<string | null>(null)
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (open) reasonRef.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      triggerRef.current?.focus()
    }
  }, [open])

  function cancel() {
    restoreFocus.current = true
    setOpen(false)
  }

  let remaining = 24_000
  const transcript = open ? messages.slice(-16).reverse().flatMap(({ role, parts }) => {
    if (role !== "user" && role !== "assistant") return []
    const text = parts.filter(part => part.type === "text").map(part => part.text).join("\n\n")
      .trim().slice(0, Math.min(6_000, remaining))
    remaining -= text.length
    return text ? [{ role, text }] : []
  }).reverse() : []

  async function send() {
    setError(false)
    setPending(true)
    try {
      const id = `chat-${requestId}`
      const readKey = readKeyRef.current ??= Array.from(crypto.getRandomValues(new Uint8Array(32)),
        byte => byte.toString(16).padStart(2, "0")).join("")
      const response = await fetch("/api/manager/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, readKey, messages: transcript, reason: reason.trim() || "Нужна помощь менеджера" }),
      })
      if (!response.ok) throw new Error("Не удалось сохранить обращение")
      const receipt = await response.json() as { id?: unknown } | null
      if (receipt?.id !== id) throw new Error("Не получен номер обращения")
      onSent({ id, readKey })
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  if (!open) return (
    <Button ref={triggerRef} type="button" variant="ghost" size="sm" className="self-start pointer-coarse:min-h-11" onClick={() => setOpen(true)}>
      <UserRoundIcon aria-hidden="true" /> Передать менеджеру
    </Button>
  )
  return (
    <Card className="py-3">
      <CardContent className="space-y-3 px-3">
        <p className="text-sm">Последние сообщения попадут в очередь менеджера демо. Проверьте, нет ли в них паролей и платёжных реквизитов.</p>
        <Collapsible>
          <CollapsibleTrigger render={<Button type="button" size="sm" variant="outline" className="pointer-coarse:min-h-11" />}>
            Посмотреть передаваемые сообщения
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border p-2" tabIndex={0} aria-label="Сообщения для менеджера">
              {transcript.map((message, index) => <li key={index} className="text-xs wrap-anywhere whitespace-pre-wrap">
                <strong>{message.role === "user" ? "Вы" : "Помощник"}</strong>
                <p>{message.text}</p>
              </li>)}
            </ol>
          </CollapsibleContent>
        </Collapsible>
        <form className="grid gap-2.5" onSubmit={event => { event.preventDefault(); void send() }}>
          <label className="grid gap-1 text-sm">Что уточнить у менеджера<Input ref={reasonRef} value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} size="sm" className="pointer-coarse:min-h-11">{pending ? "Передаю…" : "Подтвердить передачу"}</Button>
            <Button type="button" variant="outline" disabled={pending} size="sm" className="pointer-coarse:min-h-11" onClick={cancel}>Отмена</Button>
          </div>
        </form>
        {error && <Alert role="alert" variant="destructive"><AlertDescription>Не удалось передать обращение. Попробуйте ещё раз.</AlertDescription></Alert>}
      </CardContent>
    </Card>
  )
}
