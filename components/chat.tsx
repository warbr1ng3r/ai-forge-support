"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, getToolName, isToolUIPart, safeValidateUIMessages } from "ai"
import { LayersIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { ChatMessage } from "@/components/chat-message"
import { ChatHandoff, HandoffReplies, useHandoffReceipts } from "@/components/chat-handoff"
import { PromptForm } from "@/components/prompt-form"
import { StatusIcon } from "@/components/status-icon"
import { Suggestions } from "@/components/suggestions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

const chatStorageKey = "support-chat-history"
const recentMessageLimit = 16

const transport = new DefaultChatTransport({
  prepareSendMessagesRequest: ({ messages }) => {
    const recent = messages.slice(-recentMessageLimit)
    const previousOfferIds = new Set<string>()
    for (const message of [...recent].reverse()) {
      if (message.role !== "assistant") continue
      for (const part of [...message.parts].reverse()) {
        if (previousOfferIds.size === 12) break
        if (!isToolUIPart(part) || part.state !== "output-available") continue
        if (!["searchCatalog", "discoverCatalog", "findOffer", "verifyFit", "prepareDocuments"].includes(getToolName(part))) continue
        const output = part.output
        if (!output || typeof output !== "object" || !("offers" in output) || !Array.isArray(output.offers)) continue
        for (const offer of output.offers) {
          if (previousOfferIds.size === 12) break
          if (offer && typeof offer === "object" && typeof offer.id === "string") previousOfferIds.add(offer.id)
        }
      }
    }
    return {
      body: {
        messages: recent.flatMap(({ id, role, parts }) => {
          const text = parts.filter(part => part.type === "text").map(part => part.text).join("\n\n").slice(0, 6000)
          return text.trim() ? [{ id, role, parts: [{ type: "text", text }] }] : []
        }),
        previousOfferIds: [...previousOfferIds],
      },
    }
  },
})

function errorText(message: string) {
  if (message.startsWith("{")) {
    try {
      const payload = JSON.parse(message)
      if (typeof payload?.error === "string") return payload.error
    } catch {
      return "Не удалось получить ответ. Попробуйте ещё раз."
    }
  }
  return /[а-яё]/i.test(message) && !message.startsWith("<")
    ? message
    : "Не удалось получить ответ. Попробуйте ещё раз."
}

export function Chat() {
  const { messages, setMessages, sendMessage, regenerate, status, stop, error, clearError } = useChat({ transport, throttle: 50 })
  const { receipts, addReceipt } = useHandoffReceipts()
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isBusy = status === "submitted" || status === "streaming"
  const lastMessage = messages.at(-1)
  const lastUserId = messages.findLast(message => message.role === "user")?.id
  const currentHandoffId = lastUserId ? `chat-${lastUserId}` : undefined
  const hasMessages = messages.length > 0
  const activeHandoffIds = new Set(messages.filter(message => message.role === "user").map(message => `chat-${message.id}`))
  const activeReceipts = receipts.filter(receipt => activeHandoffIds.has(receipt.id))
  const previousReceipts = receipts.filter(receipt => !activeHandoffIds.has(receipt.id))
  const previousHandoffs = previousReceipts.length > 0 && (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger render={<Button type="button" variant="outline" size="sm" className="pointer-coarse:min-h-11" />}>
        Предыдущие обращения · {previousReceipts.length}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        {previousReceipts.map(receipt => <HandoffReplies key={receipt.id} receipt={receipt} focus={false} />)}
      </CollapsibleContent>
    </Collapsible>
  )
  const waitingForText = isBusy && (lastMessage?.role !== "assistant"
    || !lastMessage.parts.some((part) => part.type === "text" && part.text.trim()))

  useEffect(() => {
    let active = true
    async function restoreHistory() {
      try {
        const stored = sessionStorage.getItem(chatStorageKey)
        if (!stored) return
        const history = await safeValidateUIMessages({ messages: JSON.parse(stored) })
        if (active && history.success) {
          setMessages(current => current.length ? current : history.data.slice(-recentMessageLimit))
        }
      } catch {
        // Chat still works if tab storage is unavailable.
      } finally {
        if (active) setHistoryLoaded(true)
      }
    }
    void restoreHistory()
    return () => { active = false }
  }, [setMessages])

  useEffect(() => {
    if (!historyLoaded || !messages.length || status === "streaming") return
    try {
      sessionStorage.setItem(chatStorageKey, JSON.stringify(messages.slice(-recentMessageLimit)))
    } catch {
      // The chat remains usable if the browser cannot save it.
    }
  }, [historyLoaded, messages, status])

  function send(text: string) {
    if (isBusy) return
    clearError()
    void sendMessage({ text })
  }

  function useExample(text: string) {
    setDraft(text)
    inputRef.current?.focus()
  }

  function retry() {
    clearError()
    void regenerate()
  }

  function startNewChat() {
    clearError()
    setMessages([])
    setDraft("")
    try {
      sessionStorage.removeItem(chatStorageKey)
    } catch {
      // Storage may be disabled in this tab.
    }
    inputRef.current?.focus()
  }

  return (
    <main className="mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <p role="status" className="sr-only">
        {status === "submitted" ? "Запрос отправлен" : status === "streaming" ? "Помощник отвечает"
          : status === "ready" && lastMessage?.role === "assistant" ? "Ответ готов" : ""}
      </p>
      {hasMessages && (
        <div className="chat-gutter shrink-0 overflow-hidden">
          <div className="chat-column flex justify-end py-1">
            <Button type="button" variant="ghost" size="sm" disabled={isBusy} onClick={startNewChat} className="pointer-coarse:min-h-11">
              Новый подбор
            </Button>
          </div>
        </div>
      )}
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          {hasMessages ? (
            <MessageScrollerViewport aria-label="Переписка" className="flex-1 [mask-image:none]">
              <MessageScrollerContent className="chat-column flex flex-col gap-5 py-4 sm:gap-6 sm:py-6">
                {messages.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                    <ChatMessage message={message} onRetry={!isBusy && !error && message.id === lastMessage?.id ? retry : undefined} />
                  </MessageScrollerItem>
                ))}
                {waitingForText && (
                  <MessageScrollerItem messageId="thinking">
                    <Message>
                      <MessageContent>
                        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-hidden="true">
                          <span className="[&_svg]:size-4 motion-reduce:[&_svg]:animate-none">
                            <StatusIcon status="running" />
                          </span>
                          Готовлю ответ…
                        </p>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )}
                {activeReceipts.map(receipt => (
                  <MessageScrollerItem key={receipt.id} messageId={receipt.id}>
                    <HandoffReplies receipt={receipt} focus={receipt.id === currentHandoffId} />
                  </MessageScrollerItem>
                ))}
                {lastUserId && !isBusy && !receipts.some(receipt => receipt.id === currentHandoffId) && (
                  <ChatHandoff key={lastUserId} requestId={lastUserId} messages={messages} onSent={addReceipt} />
                )}
                {previousHandoffs}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          ) : (
            <div className="chat-gutter min-h-0 overflow-y-auto">
              <section className="chat-column space-y-3 pt-4 pb-3 sm:pt-10 sm:pb-5 lg:pt-16" aria-labelledby="welcome-title">
                <div className="grid min-w-0 overflow-hidden rounded-2xl border bg-card lg:grid-cols-[0.95fr_1.05fr]">
                  <div className="flex flex-col justify-center gap-3 bg-[#1e2c52] p-4 text-[#f3f5ff] max-sm:[@media(max-height:650px)]:gap-2 max-sm:[@media(max-height:650px)]:p-3 sm:gap-4 sm:p-8 dark:bg-[#253657]">
                    <LayersIcon aria-hidden="true" className="size-6 text-[#c8c5fb] max-sm:[@media(max-height:650px)]:hidden" />
                    <h2 id="welcome-title" className="max-w-[16ch] text-2xl/[1.08] font-semibold tracking-tight sm:text-4xl lg:text-[2.65rem]">
                      Подберите ПО под вашу задачу
                    </h2>
                    <p className="max-w-[38ch] text-sm/relaxed text-[#dde4fa] sm:text-[15px]">
                      Назовите продукт или опишите задачу. Помощник сверит лицензии по каталогу Softline.
                    </p>
                  </div>
                  <div className="min-w-0 p-2.5 sm:p-5">
                    <Suggestions onSelect={useExample} />
                  </div>
                </div>
                {previousHandoffs}
              </section>
            </div>
          )}
          <div className="relative shrink-0">
            {hasMessages && (
              <div className="chat-gutter pointer-events-none absolute inset-x-0 bottom-full z-10 overflow-hidden">
                <div className="chat-column flex justify-end py-2">
                  <MessageScrollerButton
                    aria-label="К последнему сообщению"
                    className="static size-11 shrink-0 translate-none border shadow-sm data-[active=false]:hidden data-[active=true]:pointer-events-auto"
                  />
                </div>
              </div>
            )}
            <div className="chat-gutter overflow-hidden">
              <div className="chat-column flex flex-col gap-2 pt-1 pb-3 sm:pb-4">
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>Ошибка при обработке запроса</AlertTitle>
                    <AlertDescription>{errorText(error.message)}</AlertDescription>
                    {hasMessages && (
                      <Button type="button" variant="outline" size="sm" className="mt-2 justify-self-start pointer-coarse:min-h-11" onClick={retry}>
                        Повторить запрос
                      </Button>
                    )}
                  </Alert>
                )}
                <PromptForm isBusy={isBusy} onSubmit={send} onStop={() => void stop()} input={draft} setInput={setDraft} inputRef={inputRef} />
              </div>
            </div>
          </div>
        </MessageScroller>
      </MessageScrollerProvider>
    </main>
  )
}
