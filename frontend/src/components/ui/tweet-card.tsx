import { useState, type ReactNode } from 'react';
import { TweetContainer } from 'react-tweet';
import { cn } from '@/lib/utils';

export type TweetAuthor = { name: string; handle: string; avatar?: string; url?: string };
type TweetCardProps = { author: TweetAuthor; text: string; metadata?: ReactNode; children?: ReactNode; className?: string };

// Magic UI's tweet-card, adapted to unpublished Lab drafts instead of a published tweet ID.
// Keep React Tweet's article container and author/body structure; all content is supplied by the caller.
export function TweetAvatar({ author, size = 42 }: { author: TweetAuthor; size?: number }) {
  const [failed, setFailed] = useState(false);
  return author.avatar && !failed
    ? <img className="tweet-avatar" src={author.avatar} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="tweet-avatar tweet-avatar-fallback" style={{ width: size, height: size }} aria-hidden="true">{author.name.slice(0, 2).toUpperCase() || author.handle.slice(0, 2).toUpperCase()}</span>;
}

export function TweetHeader({ author }: { author: TweetAuthor }) {
  return <div className="tweet-header">
    <TweetAvatar key={author.avatar || author.handle} author={author} />
    <div className="tweet-author"><strong>{author.name}</strong>{author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer">@{author.handle.replace(/^@/, '')}</a> : <span>@{author.handle.replace(/^@/, '')}</span>}</div>
    <span className="tweet-preview-label">Preview</span>
  </div>;
}

export function TweetBody({ text }: { text: string }) {
  return <p className="tweet-body">{text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : <span key={i}>{part}</span>)}</p>;
}

export function TweetCard({ author, text, metadata, children, className }: TweetCardProps) {
  return <TweetContainer className={cn('lab-tweet', className)}><TweetHeader author={author} /><TweetBody text={text} />{metadata && <div className="tweet-metadata">{metadata}</div>}{children}</TweetContainer>;
}
