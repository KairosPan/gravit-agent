import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import "./index.css";

const PREFS_KEY = "gravit-ui.prefs";

/** cream and black are the current client's stored names. Missing or system follows the OS. */
function resolvedDark(): boolean {
  const query = new URLSearchParams(window.location.search).get("theme");
  if (query === "dark") return true;
  if (query === "light") return false;
  let stored: unknown;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs: unknown = raw ? JSON.parse(raw) : null;
    stored = prefs !== null && typeof prefs === "object" && !Array.isArray(prefs)
      ? (prefs as { theme?: unknown }).theme
      : undefined;
  } catch {
    stored = undefined;
  }
  if (stored === "cream" || stored === "light") return false;
  if (stored === "black" || stored === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const dark = resolvedDark();
document.documentElement.classList.toggle("dark", dark);
document.documentElement.style.colorScheme = dark ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
