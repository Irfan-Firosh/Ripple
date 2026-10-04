export type ResearchSource = { title: string; url: string; date: string; summary: string };
export type ResearchCall = { id: string; query: string; status: 'running' | 'done' | 'failed'; at: string; durationMs: number; results: number | null };
export type ResearchSnapshot = { sources: ResearchSource[]; calls: ResearchCall[]; cachedAt: string | null };
