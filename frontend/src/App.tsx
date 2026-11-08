import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import { Skeleton } from "./components/domain";
import { AppShell } from "./components/layout/AppShell";

const Landing = lazy(() => import("./pages/Landing"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
const ProactiveDefense = lazy(() => import("./pages/ProactiveDefense"));
const LiveCall = lazy(() => import("./pages/LiveCall"));
const PrivacySieve = lazy(() => import("./pages/PrivacySieve"));
const WarRoom = lazy(() => import("./pages/WarRoom"));
const Reports = lazy(() => import("./pages/Reports"));
const Evaluation = lazy(() => import("./pages/Evaluation"));
const NotFound = lazy(() => import("./pages/NotFound"));

const PageFallback = <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-[480px] rounded-2xl" /></div>;

function ConsoleLayout() {
  return (
    <AppShell>
      <Suspense fallback={PageFallback}><Outlet /></Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<ConsoleLayout />}>
          <Route path="/command" element={<CommandCenter />} />
          <Route path="/proactive" element={<ProactiveDefense />} />
          <Route path="/live-call" element={<LiveCall />} />
          <Route path="/privacy" element={<PrivacySieve />} />
          <Route path="/war-room" element={<WarRoom />} />
          <Route path="/war-room/:id" element={<WarRoom />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:id" element={<Reports />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
