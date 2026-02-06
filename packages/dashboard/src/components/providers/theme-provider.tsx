import type { T as Theme } from "@/lib/theme";
import { setThemeServerFn } from "@/lib/theme";
import { useRouter } from "@tanstack/react-router";
import type { PropsWithChildren } from "react";
import { createContext, use } from "react";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

type Props = PropsWithChildren<{ theme: Theme }>;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, theme }: Props) {
  const router = useRouter();

  function setTheme(theme: Theme) {
    void setThemeServerFn({ data: theme }).then(() => router.invalidate());
  }

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const themeContext = use(ThemeContext);
  if (!themeContext)
    throw new Error("useTheme called outside of ThemeProvider!");
  return themeContext;
}
