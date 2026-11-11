import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "../../src/styles.css";
import Referrals from "../../src/Referrals.jsx";

const theme = createTheme({
  primaryColor: "terra",
  autoContrast: true,
  primaryShade: { light: 7, dark: 7 },
  defaultRadius: "md",
  fontFamily: "Inter, sans-serif",
  headings: {
    fontFamily: "Bricolage Grotesque, sans-serif",
    fontWeight: "600",
  },
  colors: {
    terra: [
      "#fff2ed",
      "#ffded1",
      "#f8b9a2",
      "#ef9678",
      "#df7654",
      "#cb5e3c",
      "#b94d2f",
      "#a43d28",
      "#8d3322",
      "#752b1f",
    ],
    dark: [
      "#f7f5ef",
      "#dbd4ca",
      "#b9b0a5",
      "#8a7f73",
      "#62584e",
      "#453c34",
      "#332d27",
      "#251f1b",
      "#1d1915",
      "#15120f",
    ],
  },
});
function App() {
  const [dirty, setDirty] = useState(false);
  const locked = new URLSearchParams(location.search).has("locked");
  const dark = new URLSearchParams(location.search).has("dark");
  return (
    <MantineProvider theme={theme} forceColorScheme={dark ? "dark" : "light"}>
      <main
        className="content"
        style={{ maxWidth: 1240, margin: "auto" }}
        data-dirty={dirty}
      >
        <Referrals
          features={{ referrals: !locked }}
          staff={{ business_id: "11111111-1111-4111-8111-111111111111" }}
          onDirty={setDirty}
        />
      </main>
    </MantineProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
