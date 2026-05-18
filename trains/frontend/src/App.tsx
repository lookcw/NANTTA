import { Navigate, Route, Routes } from "react-router-dom";

import { Setup } from "./setup/Setup";

function DisplayStub() {
  return <main style={{ padding: 24 }}>Display (React) — coming in Phase 4d.</main>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/setup" replace />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/display" element={<DisplayStub />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}
