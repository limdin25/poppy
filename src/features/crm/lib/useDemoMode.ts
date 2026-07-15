// useDemoMode — single source of truth for the `?demo=1` URL flag that
// unlocks legacy mock-data fallbacks across pages. Default is `false` so
// production calls and contacts never see Sarah Jenkins / Tom Richards
// / fake transcripts. Hugo / internal demos can re-enable by appending
// `?demo=1` to the URL.

import { useSearchParams } from 'react-router-dom';

export function useDemoMode(): boolean {
  const [searchParams] = useSearchParams();
  return searchParams.get('demo') === '1';
}
