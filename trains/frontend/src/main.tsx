import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";

// Stylesheet shared with the legacy Turbo templates. Importing it here lets
// Vite hash + fingerprint the CSS the same way it does the JS bundle.
import "../../static/trains/style.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("missing #app mount node");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
