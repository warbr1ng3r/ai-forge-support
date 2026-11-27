"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 rounded-lg"
      aria-label="Переключить цветовую тему"
      aria-pressed={mounted ? resolvedTheme === "dark" : undefined}
      title="Переключить цветовую тему"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <MoonIcon className="size-[18px] dark:hidden" aria-hidden="true" />
      <SunIcon className="hidden size-[18px] dark:block" aria-hidden="true" />
    </Button>
  );
}
