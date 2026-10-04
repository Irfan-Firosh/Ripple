import { useCallback, useEffect, useRef, useState } from 'react';
import { DbConnection } from '../module_bindings';
import type { BrandKit, Brief, Campaign, Job, Variant } from './model';

const URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
const DATABASE = import.meta.env.VITE_SPACETIMEDB_DATABASE || 'ripple-mhacks';
const TOKEN_KEY = `ripple-creative-token:${URI}:${DATABASE}`;
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useCreative(brandId: string, campaignId: string | null) {
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [identity, setIdentity] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [baseReady, setBaseReady] = useState(false);
  const [audienceReady, setAudienceReady] = useState(false);
  const [subscribedCampaign, setSubscribedCampaign] = useState<string | null>(null);
  const campaignReady = campaignId !== null && subscribedCampaign === campaignId;
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let token: string | undefined;
    try { token = localStorage.getItem(TOKEN_KEY) || undefined; } catch { /* Identity still works for this session. */ }
    setStatus('connecting'); setError(''); setBaseReady(false); setAudienceReady(false); setSubscribedCampaign(null);
    const conn = DbConnection.builder().withUri(URI).withDatabaseName(DATABASE).withToken(token)
      .onConnect((ctx, owner, nextToken) => {
        if (disposed) { ctx.disconnect(); return; }
        try { localStorage.setItem(TOKEN_KEY, nextToken); } catch { /* Optional persistence. */ }
        setIdentity(owner.toHexString()); setConnection(ctx); setStatus('connected');
      })
      .onConnectError((_ctx, cause) => { if (!disposed) { setError(errorText(cause)); setStatus('disconnected'); } })
      .onDisconnect((_ctx, cause) => { if (!disposed) { setConnection(null); setStatus('disconnected'); if (cause) setError(errorText(cause)); } })
      .build();
    return () => { disposed = true; mounted.current = false; conn.disconnect(); };
  }, [attempt]);

  useEffect(() => {
    if (!connection || !identity) return;
    const bump = () => setRevision(value => value + 1);
    // Subscribe only to this database identity's history. Clerk identity is separate.
    const tables = [connection.db.brandKit, connection.db.niche, connection.db.twinNiche, connection.db.campaign];
    for (const table of tables) { table.onInsert(bump); table.onUpdate(bump); table.onDelete(bump); }
    const subscription = connection.subscriptionBuilder()
      .onApplied(() => { setBaseReady(true); bump(); })
      .onError(ctx => { setError(errorText(ctx.event)); setBaseReady(false); })
      .subscribe(['SELECT * FROM brand_kit', 'SELECT * FROM niche', 'SELECT * FROM twin_niche', `SELECT * FROM campaign WHERE created_by = 0x${identity}`]);
    return () => {
      for (const table of tables) { table.removeOnInsert(bump); table.removeOnUpdate(bump); table.removeOnDelete(bump); }
      subscription.unsubscribe(); setBaseReady(false);
    };
  }, [connection, identity]);

  useEffect(() => {
    setAudienceReady(false);
    if (!connection) return;
    const bump = () => setRevision(value => value + 1);
    const table = connection.db.twinAudience;
    table.onInsert(bump); table.onUpdate(bump); table.onDelete(bump);
    const subscription = connection.subscriptionBuilder()
      .onApplied(() => { setAudienceReady(true); bump(); })
      .onError(ctx => setError(errorText(ctx.event)))
      .subscribe(`SELECT * FROM twin_audience WHERE brand_user_id = ${sqlString(brandId)}`);
    return () => { table.removeOnInsert(bump); table.removeOnUpdate(bump); table.removeOnDelete(bump); subscription.unsubscribe(); };
  }, [connection, brandId]);

  useEffect(() => {
    setSubscribedCampaign(null);
    if (!connection || !campaignId) return;
    let cancelled = false;
    const bump = () => setRevision(value => value + 1);
    const tables = [connection.db.creativeBrief, connection.db.adVariant, connection.db.creativeJob];
    for (const table of tables) { table.onInsert(bump); table.onUpdate(bump); table.onDelete(bump); }
    const subscription = connection.subscriptionBuilder()
      .onApplied(() => { if (!cancelled) { setSubscribedCampaign(campaignId); bump(); } })
      .onError(ctx => setError(errorText(ctx.event)))
      .subscribe(['creative_brief', 'ad_variant', 'creative_job'].map(table => `SELECT * FROM ${table} WHERE campaign_id = ${sqlString(campaignId)}`));
    return () => {
      cancelled = true;
      for (const table of tables) { table.removeOnInsert(bump); table.removeOnUpdate(bump); table.removeOnDelete(bump); }
      subscription.unsubscribe();
    };
  }, [connection, campaignId]);

  // Rows are immutable SDK snapshots; copy before sorting/editing.
  void revision;
  const campaigns: Campaign[] = connection && baseReady ? [...connection.db.campaign.iter()].filter(row => row.createdBy.toHexString() === identity).reverse() : [];
  const briefs: Brief[] = connection && campaignReady ? [...connection.db.creativeBrief.iter()].filter(row => row.campaignId === campaignId) : [];
  const variants: Variant[] = connection && campaignReady ? [...connection.db.adVariant.iter()].filter(row => row.campaignId === campaignId) : [];
  const jobs: Job[] = connection && campaignReady ? [...connection.db.creativeJob.iter()].filter(row => row.campaignId === campaignId) : [];
  const brandKits: BrandKit[] = connection && baseReady ? [...connection.db.brandKit.iter()] : [];
  const catalog = connection && baseReady ? [...connection.db.niche.iter()] : [];
  const affinities = connection && baseReady ? [...connection.db.twinNiche.iter()] : [];
  const audience = connection && audienceReady ? [...connection.db.twinAudience.iter()] : [];
  const run = useCallback(async (action: (conn: DbConnection) => Promise<unknown>) => {
    if (!connection || status !== 'connected') throw new Error('Connect to SpacetimeDB before changing this campaign.');
    try { await action(connection); } catch (cause) { if (mounted.current) setError(errorText(cause)); throw cause; }
  }, [connection, status]);
  return { status, error, clearError: () => setError(''), reconnect: () => setAttempt(value => value + 1), identity,
    ready: baseReady && audienceReady, campaignReady, campaigns, briefs, variants, jobs, brandKits, catalog, affinities, audience, run };
}
