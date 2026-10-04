// Magic UI ClientTweetCard, MIT licensed. Source: https://magicui.design/r/client-tweet-card.json
"use client"

import { useTweet, type TweetProps } from "react-tweet"

import {
  MagicTweet,
  TweetNotFound,
  TweetSkeleton,
} from "@/registry/magicui/tweet-card"

const PublishedTweetCard = ({
  id,
  apiUrl,
  fallback = <TweetSkeleton />,
  components,
  fetchOptions,
  onError,
  ...props
}: TweetProps & { className?: string }) => {
  const { data, error, isLoading } = useTweet(id, apiUrl, fetchOptions)

  if (isLoading) return fallback
  if (error || !data) {
    const NotFound = components?.TweetNotFound ?? TweetNotFound
    return <NotFound error={onError ? onError(error) : error} />
  }

  return <MagicTweet tweet={data} {...props} />
}


import { type ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { TweetAvatar, TweetBody, type TweetAuthor } from "@/components/ui/tweet-card";
import "./tweet-card.css";

export type DraftTweet = { author: TweetAuthor; text: string; verified?: boolean };
type DraftProps = { draft: DraftTweet; className?: string; children?: ReactNode; label: string; busy?: boolean; scrollable?: boolean; footer?: ReactNode };

// Unpublished campaign drafts use the same Magic UI client card layout, supplied by Ripple's live data.
// Published tweets retain the original id/useTweet implementation above.
export function ClientTweetCard(props: (TweetProps & { className?: string }) | DraftProps) {
  if (!("draft" in props)) return <PublishedTweetCard {...props} />;
  const { author, text, verified } = props.draft;
  return <article className={`magic-client-tweet ${props.className ?? ""}`} aria-label={props.label} aria-busy={props.busy}>
    <div className="magic-tweet-header"><div className="magic-tweet-identity"><TweetAvatar author={author} size={48} /><div><strong>{author.name}{verified && <BadgeCheck size={17} className="magic-tweet-verified" aria-label="Verified account" />}</strong><span>@{author.handle.replace(/^@/, "")}</span></div></div><svg className="magic-tweet-x" viewBox="0 0 24 24" aria-label="X post preview" role="img"><path fill="currentColor" d="M18.9 2h3.1l-6.8 7.8L23.2 22h-6.3l-4.9-7.4L5.5 22H2.3l7.3-8.4L1.8 2h6.5l4.4 6.7L18.9 2ZM17.8 20h1.7L7.4 4H5.6l12.2 16Z" /></svg></div>
    {props.scrollable ? <div className="magic-tweet-scroll" role="region" aria-label={`${props.label} post`} tabIndex={0}><TweetBody text={text} />{props.children}</div>
      : <><TweetBody text={text} />{props.children}</>}
    {props.footer}
  </article>;
}
