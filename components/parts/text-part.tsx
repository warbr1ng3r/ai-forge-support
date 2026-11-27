"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"

function ScrollableTable({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const [overflows, setOverflows] = useState(false)
  const hintId = useId()

  useEffect(() => {
    const element = wrapper.current
    const content = table.current
    if (!element || !content) return
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(content)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-w-0">
      {overflows && (
        <p id={hintId} className="not-typeset mt-4 text-xs text-muted-foreground">
          Прокрутите таблицу в сторону, чтобы увидеть все столбцы.
        </p>
      )}
      <div
        ref={wrapper}
        className="typeset-scroll max-w-full overscroll-x-contain rounded-sm focus-visible:outline focus-visible:outline-ring"
        role="region"
        aria-label="Таблица в ответе"
        aria-describedby={overflows ? hintId : undefined}
        tabIndex={overflows ? 0 : undefined}
      >
        <table
          ref={table}
          className="w-full! max-w-none! text-sm! has-[tr>:nth-child(5)]:min-w-[44rem] has-[tr>:nth-child(5)]:table-fixed has-[tr>:nth-child(5)]:[&_tr>:first-child]:w-44 sm:has-[tr>:nth-child(5)]:[&_tr>:first-child]:w-56 [&_thead]:bg-muted/60 [&_th]:align-top [&_td]:align-top [&_th]:wrap-break-word [&_td]:wrap-break-word [&_th]:whitespace-normal [&_tr>:first-child]:pl-3"
        >
          {children}
        </table>
      </div>
    </div>
  )
}

const renderers: Components = {
  a: ({ href, children }) =>
    href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>,
  table: ({ children }) => <ScrollableTable>{children}</ScrollableTable>,
}

function httpsOnly(value: string) {
  try {
    return new URL(value).protocol === "https:" ? value : ""
  } catch {
    return ""
  }
}

export function TextPart({ part }: { part: { text: string } }) {
  return (
    <div className="typeset typeset-docs min-w-0 wrap-break-word [&>p]:max-w-[72ch] [&>ul]:max-w-[72ch] [&>ol]:max-w-[72ch]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} urlTransform={httpsOnly} components={renderers}>
        {part.text}
      </ReactMarkdown>
    </div>
  )
}
