"use client"

import * as React from "react"
import { ArrowUpIcon, SquareIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

export function PromptForm({
  isBusy,
  onSubmit,
  onStop,
  input,
  setInput,
  inputRef,
}: {
  isBusy: boolean
  onSubmit: (text: string) => void
  onStop: () => void
  input: string
  setInput: (value: string) => void
  inputRef: React.Ref<HTMLTextAreaElement>
}) {
  const demoNoticeId = React.useId()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()
    if (!text || isBusy) return
    if (document.activeElement?.matches("button:focus-visible")) {
      event.currentTarget.querySelector("textarea")?.focus()
    }
    onSubmit(text)
    setInput("")
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-1.5">
      <p id={demoNoticeId} className="px-1 text-xs text-muted-foreground">
        Демо на каталоге Softline. Вводите только вымышленные данные.
      </p>
      <InputGroup className="rounded-xl border-input bg-card has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring">
        <InputGroupTextarea
          ref={inputRef}
          aria-label="Ваш запрос"
          aria-describedby={demoNoticeId}
          placeholder="Напишите, что вам нужно…"
          className="min-h-11 max-h-[min(10rem,25dvh)] overflow-y-auto px-3 py-2.5 text-base"
          maxLength={4000}
          enterKeyHint="send"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="self-end p-1 has-[>button]:mr-0">
          {isBusy ? (
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Остановить ответ"
              className="size-9 pointer-coarse:size-11"
              onClick={(event) => {
                if (event.currentTarget.matches(":focus-visible")) {
                  event.currentTarget.form?.querySelector("textarea")?.focus()
                }
                onStop()
              }}
            >
              <SquareIcon />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label="Отправить запрос"
              className="size-9 pointer-coarse:size-11"
              disabled={!input.trim()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
