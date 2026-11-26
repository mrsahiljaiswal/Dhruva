import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((part, index) => {
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (!link) {
      return <span key={index}>{part}</span>;
    }
    return (
      <a key={index} href={link[2]} className="underline" target="_blank" rel="noreferrer">
        {link[1]}
      </a>
    );
  });
}

export function MarkdownBody({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <div className="space-y-4 text-base leading-7">
      {blocks.map((block, index) => {
        if (block.trim().startsWith("```")) {
          const code = block.replace(/^```[a-z0-9]*\n?/i, "").replace(/```$/, "");
          return (
            <pre key={index} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {code}
            </pre>
          );
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(block.trim());
        if (heading && !block.includes("\n")) {
          const text = heading[2] ?? "";
          return heading[1]?.length === 1 ? (
            <h2 key={index} className="text-xl font-semibold">
              {text}
            </h2>
          ) : (
            <h3 key={index} className="text-lg font-semibold">
              {text}
            </h3>
          );
        }
        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}
