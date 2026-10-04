import { ArrowUpRight, Check, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Brief, Campaign, Job } from '../creative/model';
import type { FlowRow } from './flowApi';
import { useCampaignResearch } from './useCampaignResearch';
import './research.css';

type Props = { brand: string; campaignId: string | null; flow: FlowRow | null; campaigns: Campaign[]; brief?: Brief; jobs: Job[]; onSelect: (id: string) => void };
const stageLabels = { concepts: 'Drafting', testing: 'In the Lab', approved: 'Ready to launch', shipped: 'Launched' };
const dateLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function CampaignResearch({ brand, campaignId, flow, campaigns, brief: incomingBrief, jobs, onSelect }: Props) {
  const { flows, research, flowError, researchError, retry } = useCampaignResearch(brand, campaignId);
  const [showActivity, setShowActivity] = useState(true);
  const searching = research?.calls.some(call => call.status === 'running') ?? false;
  useEffect(() => { if (searching) setShowActivity(true); }, [searching]);
  const active = flows ?? [];
  const campaign = campaigns.find(row => row.campaignId === campaignId);
  const brief = incomingBrief?.campaignId === campaignId ? incomingBrief : undefined;
  const currentJobs = jobs.filter(job => job.campaignId === campaignId);
  const failed = currentJobs.find(job => job.status === 'failed');
  const interests = brief?.keyInterests.map(interest => interest.text).slice(0, 2);
  return <section className="flow-intelligence" aria-label="Campaign activity">
    <aside className="research-campaigns" aria-labelledby="drafting-title">
      <div className="research-heading"><h2 id="drafting-title">Campaign history</h2><span>{active.length}</span></div>
      {flowError ? <p className="research-empty">{flowError} <button onClick={retry}>Try again</button></p>
        : flows === null ? <p className="research-empty">Reading campaigns…</p>
          : !active.length ? <p className="research-empty">No campaigns yet.</p>
            : <div className="research-campaign-list">{active.map(row => {
              const name = campaigns.find(item => item.campaignId === row.campaign_id)?.name
                || (row.source === 'import' ? row.draft_a.split('\n')[0]?.slice(0, 80) : `@${row.brand} campaign`);
              return <button key={row.campaign_id} aria-current={row.campaign_id === campaignId ? 'true' : undefined} onClick={() => onSelect(row.campaign_id)}>
                <span>{name || 'Imported drafts'}</span><small><i data-stage={row.stage} />{stageLabels[row.stage]}<ArrowUpRight size={13} /></small>
              </button>;
            })}</div>}
    </aside>
    <div className="research-panel">
      <div className="research-heading"><h2>Behind the campaign</h2><span>EXA · @{brand}</span></div>
      <details className="research-log" open={showActivity} onToggle={event => setShowActivity(event.currentTarget.open)}>
        <summary>Search activity <span>{research?.calls.length ?? 0}</span></summary>
        {research && !research.calls.length && <p className="research-empty">No searches recorded yet.</p>}
        <ol>{research?.calls.map(call => <li key={call.id} data-status={call.status}>
          {call.status === 'running' ? <LoaderCircle className="research-spinner" size={13} /> : call.status === 'done' ? <Check size={13} /> : <span aria-hidden="true">×</span>}
          <div><p>{call.query}</p><small>{call.status === 'running' ? 'Searching' : call.status === 'failed' ? 'Search failed' : `${call.results ?? 0} results · ${(call.durationMs / 1000).toFixed(1)}s`}</small></div>
          <time dateTime={call.at}>{dateLabel(call.at)}</time>
        </li>)}</ol>
      </details>
      {campaignId && <section className="research-rationale" aria-labelledby="rationale-title">
        <h3 id="rationale-title">Why this direction</h3>
        {flow?.campaign_id === campaignId && flow.source === 'import' ? <p>You supplied these drafts. They are being prepared for your audience.</p>
          : brief ? <><p>{brief.messageAngle}</p><p className="research-muted">For {brief.audienceLabel} · {brief.twinCount.toLocaleString()} audience profiles · {Math.round(brief.share * 100)}% of your audience.</p>
            {!!interests?.length && <p className="research-muted">Their interests: {interests.join(' · ')}.</p>}</>
            : <p className="research-muted">{campaign ? `${campaign.name}. ${campaign.goal}.` : 'The audience brief is being prepared.'} The rationale appears when the brief is ready.</p>}
        {failed && <p className="research-job-error" role="alert">{failed.error || 'Draft generation needs attention.'}</p>}
      </section>}
      <section className="research-sources" aria-label="Exa research sources">
        <div className="research-subheading"><h3>Brand research</h3>{research?.cachedAt && <time dateTime={research.cachedAt} title="Research cache updated">{new Date(research.cachedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time>}</div>
        {researchError ? <p className="research-empty">{researchError} <button onClick={retry}>Try again</button></p>
          : !research ? <p className="research-empty">Reading research…</p>
            : research.sources.length ? <div className="research-source-list">{research.sources.slice(0, 4).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              <div><h4>{source.title}</h4><ArrowUpRight size={14} /></div><p>{source.summary}</p><small>{source.date} · {new URL(source.url).hostname.replace(/^www\./, '')}</small>
            </a>)}</div> : <p className="research-empty">{research.calls.some(call => call.status === 'running') ? 'Exa is gathering sources…' : 'No research recorded yet.'}</p>}
      </section>

    </div>
  </section>;
}
