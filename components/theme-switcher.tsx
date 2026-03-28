"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "chatvault.ui.theme";

type ThemeId = "material" | "indigo" | "graphite" | "amoled";

const themes: Array<{ id: ThemeId; label: string }> = [
  { id: "material", label: "Material" },
  { id: "indigo", label: "Indigo" },
  { id: "graphite", label: "Graphite" },
  { id: "amoled", label: "AMOLED" }
];

function applyTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>("material");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const nextTheme = themes.some((item) => item.id === stored) ? (stored as ThemeId) : "material";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  return (
    <label className="theme-switcher">
      <span className="meta">Theme</span>
      <select
        className="select theme-select"
        value={theme}
        onChange={(event) => {
          const next = event.target.value as ThemeId;
          setTheme(next);
          applyTheme(next);
          window.localStorage.setItem(STORAGE_KEY, next);
        }}
        aria-label="Color theme"
      >
        {themes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
