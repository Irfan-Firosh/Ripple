import { useEffect, useState } from 'react';
import { sql } from '../audience/liveAudience';

export type LabComment = { id: string; runId: string; userId: string; kind: 'reply' | 'quote'; text: string; tick: number };
type CommentRow = { sim_comment_id: string; run_id: string; user_id: string; kind: string; text: string; tick: number };

// Written responses are a separate server table, not part of the shared labData contract.
export function useLabComments(runIds: string[], running: boolean) {
  const key = runIds.join('|');
  const [comments, setComments] = useState<LabComment[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    setComments([]); setError('');
    const ids = key.split('|').filter(Boolean);
    if (!ids.length) return;
    async function refresh() {
      if (document.hidden) { timer = window.setTimeout(() => void refresh(), 5000); return; }
      try {
        const rows = (await Promise.all(ids.map(id => sql<CommentRow>(`SELECT * FROM sim_comment WHERE run_id = '${id.replace(/'/g, "''")}'`, controller.signal)))).flat();
        if (controller.signal.aborted) return;
        setComments(rows.filter((row): row is CommentRow & { kind: 'reply' | 'quote' } => row.kind === 'reply' || row.kind === 'quote')
          .map(row => ({ id: String(row.sim_comment_id), runId: row.run_id, userId: row.user_id, kind: row.kind, text: row.text, tick: Number(row.tick) })));
        setError('');
      } catch (cause: unknown) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Written responses could not be read.');
      }
      timer = window.setTimeout(() => void refresh(), running ? 1000 : 5000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, running, revision]);
  return { comments, error, retry: () => setRevision(value => value + 1) };
}
