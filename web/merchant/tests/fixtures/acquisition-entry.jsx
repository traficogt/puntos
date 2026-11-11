import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "../../src/styles.css";
import Acquisition from "../../src/Acquisition.jsx";

const theme = createTheme({
  primaryColor: "terra", autoContrast: true, primaryShade: 7,
  defaultRadius: "md", fontFamily: "Inter, sans-serif",
  headings: { fontFamily: "Bricolage Grotesque, sans-serif", fontWeight: "600" },
  colors: { terra: ["#fff2ed", "#ffded1", "#f8b9a2", "#ef9678", "#df7654", "#cb5e3c", "#b94d2f", "#a43d28", "#8d3322", "#752b1f"] },
});
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")).render(
  <MantineProvider theme={theme} forceColorScheme={params.has("dark") ? "dark" : "light"}>
    <main className="content" style={{ maxWidth: 1240, margin: "auto" }}>
      <Acquisition features={{ analytics: !params.has("locked"), branded_qr: true }} staff={{ business_id: "own-business", role: params.has("manager") ? "MANAGER" : "OWNER" }} />
    </main>
  </MantineProvider>,
);
