import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { DemoProvider } from "./lib/demo";
import "./index.css";
import { installSpotlight } from "./components/motion";

installSpotlight();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <DemoProvider>
          <App />
          <Toaster theme="dark" position="top-center" toastOptions={{ className: "!rounded-xl !text-[13px] !font-sans !shadow-[var(--shadow-lift)]" }} />
        </DemoProvider>
      </TooltipProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
