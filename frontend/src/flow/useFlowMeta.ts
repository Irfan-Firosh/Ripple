// Small shared reads for the campaign flow: the brand's X profile (to draw posts like the Lab does) and the /ops
// video mode (off = no video slots).
import { useEffect, useState } from 'react';
import { sql } from '../audience/liveAudience';
import type { TweetAuthor } from '../components/ui/tweet-card';

export function useBrandAuthor(brand: string, brandId: string): TweetAuthor {
  const [author, setAuthor] = useState<TweetAuthor>({ name: brand, handle: brand, avatar: '' });
  useEffect(() => {
    const abort = new AbortController();
    setAuthor({ name: brand, handle: brand, avatar: '' });
    if (brandId) void sql<{ name: string; username: string; profile_image_url: string }>(`SELECT name, username, profile_image_url FROM x_user WHERE user_id = '${brandId.replaceAll("'", "''")}'`, abort.signal)
      .then(rows => { const row = rows[0]; if (row && !abort.signal.aborted) setAuthor({ name: row.name || brand, handle: row.username || brand, avatar: row.profile_image_url || '' }); }).catch(() => undefined);
    return () => abort.abort();
  }, [brand, brandId]);
  return author;
}

export function useVideoOff(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    void sql<{ mode: string }>("SELECT * FROM video_mode WHERE key = 'global'").then(rows => setOff(rows[0]?.mode === 'off')).catch(() => undefined);
  }, []);
  return off;
}
