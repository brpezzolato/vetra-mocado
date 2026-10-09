'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ScrollArea } from '@/components/ui/scroll-area';

export function MarkdownResponse({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h3 className="mt-3 mb-1 text-base font-semibold first:mt-0">
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h3>
        ),
        h3: ({ children }) => (
          <h4 className="mt-2.5 mb-1 font-semibold first:mt-0">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="pl-0.5 leading-relaxed [&>p]:my-0">{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[.9em]">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <ScrollArea
            orientation="horizontal"
            className="my-2 rounded-xl bg-background/70"
          >
            <pre className="p-3 pb-4 text-xs">{children}</pre>
          </ScrollArea>
        ),
        table: ({ children }) => (
          <ScrollArea orientation="horizontal" className="my-2">
            <table className="w-full border-collapse text-left text-xs">
              {children}
            </table>
          </ScrollArea>
        ),
        th: ({ children }) => (
          <th className="border-b px-2 py-1.5 font-semibold">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border-b px-2 py-1.5 align-top">{children}</td>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-foreground underline underline-offset-2"
          >
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
