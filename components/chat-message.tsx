"use client"

import type { UIMessage } from "ai"
import { RefreshCcwIcon } from "lucide-react"
import { memo } from "react"

import { TextPart } from "@/components/parts/text-part"
import { ProductCandidates } from "@/components/product-candidates"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"

export const ChatMessage = memo(function ChatMessage({
  message,
  onRetry,
}: {
  message: UIMessage
  onRetry?: () => void
}) {
  const text = message.parts.filter((part) => part.type === "text").map((part) => part.text)
  if (message.role === "user") {
    return (
      <Message align="end" role="group" aria-label="Вы">
        <MessageContent>
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{text.join("")}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  const answer = text.join("\n\n").trim()
  return (
    <Message align="start" role="group" aria-label="Помощник">
      <MessageContent>
        <ProductCandidates parts={message.parts} allowDocuments={Boolean(onRetry)} />
        {answer && <TextPart part={{ text: answer }} />}
        {answer && onRetry && (
          <MessageFooter className="px-0">
            <Button type="button" variant="ghost" size="icon-sm" className="pointer-coarse:size-11" aria-label="Повторить ответ" onClick={onRetry}>
              <RefreshCcwIcon />
            </Button>
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
})
