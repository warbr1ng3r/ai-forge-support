import type { Metadata } from "next"

import { Chat } from "@/components/chat"

export const metadata: Metadata = {
  title: "Помощник по подбору продуктов",
  description: "Подбор программ и оборудования по каталогу Softline.",
}

export default function Page() {
  return <Chat />
}
