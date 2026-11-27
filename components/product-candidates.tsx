"use client"

import { getToolName, isToolUIPart, type UIMessage } from "ai"
import { ChevronDownIcon } from "lucide-react"
import { z } from "zod"
import { cn } from "@/lib/utils"

import { CommerceDocuments } from "./commerce-documents"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent } from "./ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"

const offerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string(),
  price: z.number().nonnegative().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  priceUnit: z.enum(["узел", "почтовый адрес", "рабочую станцию или файловый сервер", "IP-адрес"]).optional(),
  quantityBounds: z.object({ min: z.number().int().positive(), max: z.number().int().positive().optional() }).optional(),
  availableInCatalog: z.boolean(),
  maxUsers: z.number().int().positive().nullable(),
  licenseOperation: z.enum(["new", "renewal", "expired_renewal", "upgrade"]).nullable(),
})

const assessmentSchema = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    verdict: z.enum(["fit", "unknown", "contradiction"]),
  })),
})

const verdicts = {
  fit: "Подходит по проверенным условиям",
  unknown: "Требуется уточнение",
  contradiction: "Не подходит под запрос",
}

const operations = {
  new: "Новая лицензия",
  renewal: "Продление",
  expired_renewal: "Продление после истечения срока",
  upgrade: "Переход на другую версию",
}

const priceFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 })
const maxOffers = 8

function catalogLink(value: string) {
  try {
    const url = new URL(value)
    if (url.origin === "https://store.softline.ru" && !url.username && !url.password) return url.href
  } catch {
    return undefined
  }
}

export function ProductCandidates({ parts, allowDocuments = false }: { parts: UIMessage["parts"]; allowDocuments?: boolean }) {
  const found = new Map<string, z.infer<typeof offerSchema>>()
  const assessments = new Map<string, keyof typeof verdicts>()
  const documentQuantities = new Map<string, number>()
  for (const part of parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue
    const tool = getToolName(part)
    const result = part.output
    if (tool === "verifyFit") {
      const checked = assessmentSchema.safeParse(result)
      if (!checked.success) continue
      for (const { id, verdict } of checked.data.candidates) assessments.set(id, verdict)
    } else if (!["searchCatalog", "discoverCatalog", "findOffer", "prepareDocuments"].includes(tool)) {
      continue
    }
    if (!result || typeof result !== "object" || !("offers" in result) || !Array.isArray(result.offers)) continue
    for (const value of result.offers) {
      const offer = offerSchema.safeParse(value)
      if (offer.success && (tool !== "verifyFit" || assessments.get(offer.data.id) === "fit")) {
        found.set(offer.data.id, offer.data)
        if (tool === "prepareDocuments" && "documentQuantity" in result &&
          typeof result.documentQuantity === "number" && Number.isSafeInteger(result.documentQuantity) && result.documentQuantity > 0) {
          documentQuantities.set(offer.data.id, result.documentQuantity)
        }
      }
    }
  }

  if (found.size === 0) return null
  const offers = [...found.values()]
    .sort((a, b) => Number(assessments.get(b.id) === "fit") - Number(assessments.get(a.id) === "fit")
      || Number(assessments.has(b.id)) - Number(assessments.has(a.id)))
    .slice(0, maxOffers)
  const label = found.size === 1 ? "Позиция из каталога" : `Позиции из каталога · ${found.size}`
  const cards = (shown: typeof offers) => (
    <ul className={shown.length > 1 ? "grid min-w-0 gap-3 md:grid-cols-2" : "min-w-0"}>
      {shown.map((offer) => {
        const url = catalogLink(offer.url)
        const currency = offer.currency === "RUR" || offer.currency === "RUB" ? "₽" : offer.currency
        const priceUnit = offer.priceUnit
        const price = offer.price ? `${priceFormat.format(offer.price)} ${currency}${priceUnit ? ` за ${priceUnit}` : ""}` : "Цена не указана"
        const verdict = assessments.get(offer.id)
        const documentQuantity = documentQuantities.get(offer.id)

        return (
          <li key={offer.id} className="min-w-0">
            <Card className={cn("h-full rounded-xl py-0 shadow-none", verdict === "fit" && "bg-fit-surface ring-fit/30")}>
              <CardContent className="flex h-full flex-col gap-2 px-4 py-4">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-[15px] leading-snug font-semibold wrap-anywhere text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-current">
                    {offer.name}
                  </a>
                ) : (
                  <p className="text-sm leading-snug font-medium wrap-anywhere">{offer.name}</p>
                )}
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  {[
                    `Позиция ${offer.id}`,
                    offer.licenseOperation && operations[offer.licenseOperation],
                    offer.maxUsers && `До ${offer.maxUsers} польз.`,
                  ].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1">
                  <span className="text-base font-semibold tabular-nums">{price}</span>
                  {!offer.availableInCatalog && <Badge variant="outline">Недоступно</Badge>}
                  {verdict && (
                    <Badge
                      variant={verdict === "unknown" ? "outline" : "secondary"}
                      className={cn("h-auto min-h-5 max-w-full text-wrap", verdict === "fit" && "bg-card text-fit", verdict === "contradiction" && "bg-danger-surface text-destructive")}
                    >
                      {verdicts[verdict]}
                    </Badge>
                  )}
                  {!verdict && assessments.size > 0 && <Badge variant="outline">Соответствие не проверено</Badge>}
                </div>
                {allowDocuments && (documentQuantity !== undefined || verdict === "fit") &&
                  <CommerceDocuments offer={offer} quantity={documentQuantity} />}
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )

  return (
    <section className="mb-4 min-w-0 space-y-2" aria-label={label}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {cards(offers.slice(0, 2))}
      {offers.length > 2 && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" className="group w-full justify-between pointer-coarse:min-h-11" />}>
            Остальные позиции · {offers.length - 2}
            <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none group-aria-expanded:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {cards(offers.slice(2))}
            {found.size > offers.length && (
              <p className="mt-2 text-xs text-muted-foreground">Показаны {offers.length} из {found.size} позиций.</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}
