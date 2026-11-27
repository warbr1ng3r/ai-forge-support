import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ArrowUpRightIcon, PackageSearchIcon } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "Подбор ПО",
  description: "Поиск программ и оборудования в каталоге Softline",
};

export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="antialiased" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <div className="flex h-dvh min-w-0 flex-col">
              <header className="shrink-0 border-b border-border bg-card">
                <div className="chat-column flex min-h-14 items-center justify-between gap-2 py-1">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <PackageSearchIcon className="size-[18px]" aria-hidden="true" />
                    </span>
                    <h1 className="text-sm font-extrabold tracking-tight sm:text-base">Подбор ПО</h1>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <a
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      href="https://store.softline.ru/"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Открыть каталог Softline в новой вкладке"
                    >
                      Каталог <span className="hidden min-[355px]:inline">Softline</span>
                      <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
                    </a>
                    <ThemeToggle />
                  </div>
                </div>
              </header>
              {children}
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
