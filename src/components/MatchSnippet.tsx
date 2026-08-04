import type { MatchSegment } from '../types';

export default function MatchSnippet({ segments }: { segments: MatchSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.highlight ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>,
      )}
    </>
  );
}
