import { Navigate, Route, Routes } from "react-router-dom";

import { Display } from "./display/Display";
import { Setup } from "./setup/Setup";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/setup" replace />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/display" element={<Display />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}
