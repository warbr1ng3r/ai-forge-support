"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai"
import { LayersIcon } from "lucide-react"
import { useRef, useState } from "react"

import { ChatMessage } from "@/components/chat-message"
import { ChatHandoff, HandoffReplies, useHandoffReceipts } from "@/components/chat-handoff"
import { PromptForm } from "@/components/prompt-form"
import { StatusIcon } from "@/components/status-icon"
import { Suggestions } from "@/components/suggestions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

const transport = new DefaultChatTransport({
  prepareSendMessagesRequest: ({ messages }) => {
    const recent = messages.slice(-16)
    const previousOfferIds = new Set<string>()
    for (const message of [...recent].reverse()) {
      if (message.role !== "assistant") continue
      for (const part of [...message.parts].reverse()) {
        if (previousOfferIds.size === 12) break
        if (!isToolUIPart(part) || part.state !== "output-available") continue
        if (!["searchCatalog", "discoverCatalog", "findOffer"].includes(getToolName(part))) continue
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
  const { messages, sendMessage, regenerate, status, stop, error, clearError } = useChat({ transport, throttle: 50 })
  const { receipts, addReceipt } = useHandoffReceipts()
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isBusy = status === "submitted" || status === "streaming"
  const lastMessage = messages.at(-1)
  const lastUserId = messages.findLast(message => message.role === "user")?.id
  const currentHandoffId = lastUserId ? `chat-${lastUserId}` : undefined
  const hasMessages = messages.length > 0
  const hasConversation = hasMessages || receipts.length > 0
  const waitingForText = isBusy && (lastMessage?.role !== "assistant"
    || !lastMessage.parts.some((part) => part.type === "text" && part.text.trim()))

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

  return (
    <main className="mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <p role="status" className="sr-only">
        {status === "submitted" ? "Запрос отправлен" : status === "streaming" ? "Помощник отвечает"
          : status === "ready" && lastMessage?.role === "assistant" ? "Ответ готов" : ""}
      </p>
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          {hasConversation ? (
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
                {receipts.map(receipt => (
                  <MessageScrollerItem key={receipt.id} messageId={receipt.id}>
                    <HandoffReplies receipt={receipt} focus={receipt.id === currentHandoffId} />
                  </MessageScrollerItem>
                ))}
                {lastUserId && !isBusy && !receipts.some(receipt => receipt.id === currentHandoffId) && (
                  <ChatHandoff key={lastUserId} requestId={lastUserId} messages={messages} onSent={addReceipt} />
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          ) : (
            <div className="min-h-0 overflow-y-auto">
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
                    <Suggestions onSelect={useExample} />
                  </div>
                </div>
              </section>
            </div>
          )}
          <div className="chat-column flex shrink-0 items-end gap-2 pb-3 sm:pb-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
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
            {hasConversation && (
              <MessageScrollerButton
                aria-label="К последнему сообщению"
                className="static size-11 shrink-0 translate-none data-[active=false]:hidden"
              />
            )}
          </div>
        </MessageScroller>
      </MessageScrollerProvider>
    </main>
  )
}
