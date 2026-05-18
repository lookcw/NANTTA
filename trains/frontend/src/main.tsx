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

// During the Phase 4 preview the SPA is mounted under /v2/*. Phase 5 swaps it
// onto the bare routes, at which point the basename collapses to "/".
const basename = window.location.pathname.startsWith("/v2") ? "/v2" : "/";

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
