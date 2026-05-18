import { Navigate, Route, Routes } from "react-router-dom";

// Phase 3 placeholder. Phases 4c/4d replace these stubs with the real
// Setup and Display components.

function SetupStub() {
  return <main style={{ padding: 24 }}>Setup (React) — coming in Phase 4c.</main>;
}

function DisplayStub() {
  return <main style={{ padding: 24 }}>Display (React) — coming in Phase 4d.</main>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/setup" replace />} />
      <Route path="/setup" element={<SetupStub />} />
      <Route path="/display" element={<DisplayStub />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  );
}
