"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "chatvault.ui.theme";
const DENSITY_STORAGE_KEY = "chatvault.ui.density";

type ThemeId =
  | "material"
  | "indigo"
  | "graphite"
  | "amoled"
  | "teal"
  | "violet"
  | "high-contrast"
  | "signal-red"
  | "neon-panels";
type Density = "comfortable" | "slim";

const themes: Array<{ id: ThemeId; label: string }> = [
  { id: "material", label: "Material" },
  { id: "indigo", label: "Indigo" },
  { id: "graphite", label: "Graphite" },
  { id: "amoled", label: "AMOLED" },
  { id: "teal", label: "Teal" },
  { id: "violet", label: "Violet" },
  { id: "high-contrast", label: "High Contrast" },
  { id: "signal-red", label: "Signal Red" },
  { id: "neon-panels", label: "Neon Panels" }
];

function applyTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function applyDensity(density: Density) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", density);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>("graphite");
  const [density, setDensity] = useState<Density>("slim");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const nextTheme = themes.some((item) => item.id === stored) ? (stored as ThemeId) : "graphite";
    const storedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
    const nextDensity: Density = storedDensity === "comfortable" ? "comfortable" : "slim";
    setTheme(nextTheme);
    setDensity(nextDensity);
    applyTheme(nextTheme);
    applyDensity(nextDensity);
  }, []);

  return (
    <div className="theme-switcher">
      <label className="theme-field">
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
      <label className="theme-field">
        <span className="meta">Density</span>
        <select
          className="select theme-select"
          value={density}
          onChange={(event) => {
            const next = event.target.value as Density;
            setDensity(next);
            applyDensity(next);
            window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
          }}
          aria-label="UI density"
        >
          <option value="comfortable">Comfortable</option>
          <option value="slim">Slim</option>
        </select>
      </label>
    </div>
  );
}
