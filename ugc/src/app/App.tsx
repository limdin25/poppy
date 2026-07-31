import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthGate } from '../features/auth/AuthGate';

const ProjectListPage = lazy(() => import('../features/project/ProjectListPage'));
const CanvasPage = lazy(() => import('../features/canvas/CanvasPage'));

export default function App() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-[12px] text-ink-subtle">Loading</div>
        }
      >
        <Routes>
          <Route path="/" element={<ProjectListPage />} />
          <Route path="/canvas/:projectId" element={<CanvasPage />} />
        </Routes>
      </Suspense>
    </AuthGate>
  );
}
