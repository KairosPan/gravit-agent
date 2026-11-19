import { Navigate, Route, Routes } from "react-router-dom";

import { KitchenSink } from "./kitchen-sink.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/kitchen-sink" replace />} />
      <Route path="/kitchen-sink" element={<KitchenSink />} />
    </Routes>
  );
}
