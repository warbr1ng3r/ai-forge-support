"use client"

import { useId, useState, type FormEvent } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Alert, AlertDescription } from "./ui/alert"
import { Button } from "./ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { Input } from "./ui/input"

type CatalogOffer = {
  id: string
  name: string
  price: number | null
  currency: string
  availableInCatalog: boolean
  priceUnit?: "узел" | "почтовый адрес" | "рабочую станцию или файловый сервер" | "IP-адрес"
  quantityBounds?: { min: number; max?: number }
  maxUsers: number | null
}

const quantityLabels = {
  "узел": "Количество узлов",
  "почтовый адрес": "Количество почтовых адресов",
  "рабочую станцию или файловый сервер": "Количество защищаемых компьютеров и серверов",
  "IP-адрес": "Количество IP-адресов",
}

const documentInputClassName = "rounded-xl border-input bg-card placeholder:text-muted-foreground pointer-coarse:min-h-11"

export function CommerceDocuments({ offer, quantity }: { offer: CatalogOffer; quantity?: number }) {
  const formId = useId()
  const [pending, setPending] = useState<"quote" | "invoice" | null>(null)
  const [error, setError] = useState("")

  if (offer.price === null || offer.price <= 0 || !["RUB", "RUR"].includes(offer.currency)) return null
  const isPackage = !offer.priceUnit && offer.maxUsers !== null && offer.maxUsers > 1
  const quantityLabel = offer.priceUnit ? quantityLabels[offer.priceUnit] : isPackage ? "Количество пакетов" : "Количество единиц"
  const range = offer.quantityBounds

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    const type = form.get("type") === "invoice" ? "invoice" : "quote"
    setError("")
    setPending(type)
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          offerId: offer.id,
          quantity: Number(form.get("quantity")),
          buyer: form.get("buyer"),
          buyerInn: String(form.get("buyerInn") ?? "").trim() || undefined,
        }),
      })
      if (!response.ok) {
        const contentType = response.headers.get("Content-Type")
        const message = contentType?.startsWith("text/plain") ? await response.text() : ""
        throw new Error(message || "Документ пока не удалось подготовить.")
      }
      const documentUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = documentUrl
      link.download = `${type}-${offer.id}.html`
      link.click()
      setTimeout(() => URL.revokeObjectURL(documentUrl), 1000)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Документ пока не удалось подготовить.")
    } finally {
      setPending(null)
    }
  }

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button type="button" size="sm" variant="outline" className="group w-full justify-between pointer-coarse:min-h-11" />}
      >
        Демо-КП и счёт
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 transition-transform motion-reduce:transition-none group-aria-expanded:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <form onSubmit={download} className="grid min-w-0 gap-3" aria-label={`Демо-документы для ${offer.name}`}>
          <p className="text-xs text-muted-foreground">Файлы HTML можно открыть в браузере и распечатать.</p>
          {!offer.availableInCatalog && (
            <Alert><AlertDescription>Фактическую поставку подтверждает менеджер. Документы используют цену со снимка каталога.</AlertDescription></Alert>
          )}
          <fieldset disabled={pending !== null} className="grid min-w-0 gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Покупатель
              <Input name="buyer" required maxLength={160} autoComplete="organization" placeholder="Название организации" className={documentInputClassName} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              ИНН <span className="sr-only">(необязательно)</span>
              <Input name="buyerInn" inputMode="numeric" pattern="[0-9]{10}|[0-9]{12}" maxLength={12} placeholder="Необязательно" className={documentInputClassName} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {quantityLabel}
              <Input name="quantity" type="number" defaultValue={quantity ?? (offer.priceUnit || range ? undefined : 1)} min={range?.min ?? 1} max={range?.max} step={1} required
                placeholder={offer.priceUnit || range ? "Укажите количество" : undefined}
                aria-describedby={range || isPackage ? `${formId}-quantity` : undefined} className={documentInputClassName} />
              {(range || isPackage) && <span id={`${formId}-quantity`} className="text-xs font-normal text-muted-foreground">
                {range ? `Диапазон тарифа от ${range.min}${range.max === undefined ? "" : ` до ${range.max}`}.`
                  : `В одном пакете до ${offer.maxUsers} пользователей.`}
              </span>}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" name="type" value="quote" variant="outline" className="pointer-coarse:min-h-11">
                {pending === "quote" ? "Готовим КП…" : "Скачать КП"}
              </Button>
              <Button type="submit" size="sm" name="type" value="invoice" variant="outline" className="pointer-coarse:min-h-11">
                {pending === "invoice" ? "Готовим счёт…" : "Скачать проект счёта"}
              </Button>
            </div>
          </fieldset>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>
      </CollapsibleContent>
    </Collapsible>
  )
}
