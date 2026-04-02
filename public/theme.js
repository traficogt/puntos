const STORAGE_KEY = "pf-theme";
const THEME_MEDIA = "(prefers-color-scheme: dark)";
const THEME_COLOR_BY_MODE = {
  dark: "#0b0f14",
  light: "#f3f6fa"
};

function isTheme(value) {
  return value === "dark" || value === "light";
}

export function resolveTheme(win = window) {
  const saved = win.localStorage.getItem("pf-theme");
  if (isTheme(saved)) return saved;
  return win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme, doc = document) {
  const nextTheme = isTheme(theme) ? theme : "dark";
  doc.documentElement.dataset.theme = nextTheme;

  const themeMeta = doc.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", THEME_COLOR_BY_MODE[nextTheme] || THEME_COLOR_BY_MODE.dark);
  }
}

export function persistTheme(theme, win = window) {
  if (!isTheme(theme)) return;
  win.localStorage.setItem(STORAGE_KEY, theme);
}

export function clearPersistedTheme(win = window) {
  win.localStorage.removeItem(STORAGE_KEY);
}

export function cycleTheme(currentTheme) {
  return currentTheme === "dark" ? "light" : "dark";
}

function bindThemeToggle(doc = document, win = window) {
  const toggle = doc.getElementById("themeToggle");
  if (!toggle) return;
  const glyph = toggle.querySelector(".theme-toggle-glyph");

  const syncLabel = () => {
    const activeTheme = doc.documentElement.dataset.theme === "light" ? "light" : "dark";
    const nextTheme = activeTheme === "dark" ? "claro" : "oscuro";
    if (glyph) glyph.textContent = activeTheme === "dark" ? "☀" : "☾";
    toggle.setAttribute("aria-label", `Cambiar a tema ${nextTheme}`);
    toggle.setAttribute("title", `Cambiar a tema ${nextTheme}`);
    toggle.setAttribute("aria-pressed", activeTheme === "light" ? "true" : "false");
  };

  toggle.addEventListener("click", () => {
    const nextTheme = cycleTheme(doc.documentElement.dataset.theme);
    persistTheme(nextTheme, win);
    applyTheme(nextTheme, doc);
    syncLabel();
  });

  syncLabel();
}

function bindSystemTheme(doc = document, win = window) {
  const media = win.matchMedia(THEME_MEDIA);
  if (typeof media.addEventListener !== "function") return;

  media.addEventListener("change", (event) => {
    const saved = win.localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return;
    applyTheme(event.matches ? "dark" : "light", doc);
    bindThemeToggle(doc, win);
  });
}

export function bootTheme(doc = document, win = window) {
  applyTheme(resolveTheme(win), doc);
  bindSystemTheme(doc, win);

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => bindThemeToggle(doc, win), { once: true });
    return;
  }
  bindThemeToggle(doc, win);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  bootTheme(document, window);
}
