export type Palette = {
  dark: boolean;
  background: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  primary: string;
  onPrimary: string;
  card: string;
  onCard: string;
  gold: string;
  error: string;
  success: string;
};
const light: Palette = {
  dark: false,
  background: "#F7F5EF",
  surface: "#FFFDFA",
  ink: "#302820",
  muted: "#675E55",
  line: "#D9D4C9",
  primary: "#A43D28",
  onPrimary: "#FFFFFF",
  card: "#302820",
  onCard: "#FFF5E4",
  gold: "#F0DDA5",
  error: "#A12C27",
  success: "#315E3C",
};
const dark: Palette = {
  dark: true,
  background: "#1C1916",
  surface: "#28231F",
  ink: "#F8F2E7",
  muted: "#C7BBAA",
  line: "#51463C",
  primary: "#F0BD80",
  onPrimary: "#302010",
  card: "#F0DDA5",
  onCard: "#302820",
  gold: "#F0DDA5",
  error: "#FFB4A6",
  success: "#A7D4AD",
};
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function palette(isDark: boolean, brand?: string): Palette {
  const p = { ...(isDark ? dark : light) };
  if (brand && /^#[a-fA-F0-9]{6}$/.test(brand)) {
    const bg = luminance(p.background),
      fg = luminance(brand);
    if ((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5) {
      p.primary = brand;
      p.onPrimary = fg > 0.179 ? "#15120F" : "#FFFFFF";
    }
  }
  return p;
}
export const fonts = {
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  bold: "Inter_600SemiBold",
  brand: "BricolageGrotesque_600SemiBold",
  display: "Fraunces_400Regular",
};
