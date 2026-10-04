import { useEffect, useState } from 'react';
import { sql, BRANDS } from '../audience/liveAudience';
import type { TweetAuthor } from '../components/ui/tweet-card';

type BrandProfile = { name: string; username: string; profile_image_url: string };
export function useLabAuthor(brand: string): TweetAuthor {
  const configured = BRANDS.find(b => b.handle === brand);
  const [profile, setProfile] = useState<{ brand: string; person: BrandProfile } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void sql<BrandProfile>(`SELECT name, username, profile_image_url FROM x_user WHERE username = '${brand.replace(/'/g, "''")}'`, controller.signal)
      .then(rows => { if (rows[0] && !controller.signal.aborted) setProfile({ brand, person: rows[0] }); })
      .catch(() => { /* An account's initials remain when its profile is unavailable. */ });
    return () => controller.abort();
  }, [brand]);
  const person = profile?.brand === brand ? profile.person : null;
  return {
    name: person?.name || (brand === 'spacetimedb' ? 'SpacetimeDB' : configured?.label.replace(/^@/, '') || brand),
    handle: person?.username || brand,
    avatar: brand === 'spacetimedb' ? '/spacetimedb-logo.png' : person?.profile_image_url?.replace('_normal.', '_200x200.'),
    url: configured?.platform === 'bluesky' ? `https://bsky.app/profile/${brand}` : `https://x.com/${brand}`,
  };
}
