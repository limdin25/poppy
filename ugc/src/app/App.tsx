import { Routes, Route } from 'react-router-dom';

// Shell only for now. Routes fill in as build steps land:
// projects list, canvas, auth, billing (see the approved plan).
function Home() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink">UGC Factory</h1>
        <p className="mt-2 text-sm text-ink-muted">Scaffold up. Canvas arrives in step 6.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
