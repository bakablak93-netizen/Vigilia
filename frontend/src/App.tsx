import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LabProvider } from "./context/LabContext";
import { UnifiedDefensePage } from "./pages/UnifiedDefensePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <LabProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<UnifiedDefensePage />} />
            <Route path="/lab" element={<Navigate to="/?section=advanced" replace />} />
            <Route path="/defense" element={<Navigate to="/?section=advanced" replace />} />
            <Route path="/evolution" element={<Navigate to="/?section=improve" replace />} />
            <Route path="/intelligence" element={<Navigate to="/?section=detect" replace />} />
            <Route path="/analyst" element={<Navigate to="/?section=detect" replace />} />
            <Route path="/benchmark" element={<Navigate to="/?section=stability" replace />} />
            <Route path="/reports" element={<Navigate to="/?panel=history" replace />} />
            <Route path="/settings" element={<Navigate to="/?panel=settings" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LabProvider>
    </QueryClientProvider>
  );
};

export default App;
