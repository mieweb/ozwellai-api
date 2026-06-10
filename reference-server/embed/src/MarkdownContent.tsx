import { useMemo, useState, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

interface MarkdownContentProps {
  text: string;
  cacheKey?: string;
  streaming?: boolean;
}

marked.use({
  gfm: true,
  breaks: true,
});

function enhanceCodeBlocks(html: string) {
  return html.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, language = '', code = '') => {
      const label = language || 'code';
      return [
        '<div class="ozwell-code-block">',
        '<div class="ozwell-code-header">',
        `<span>${label}</span>`,
        '<button type="button" class="ozwell-code-copy" data-copy-code="true">Copy</button>',
        '</div>',
        `<pre><code class="${language ? `language-${language}` : ''}">${code}</code></pre>`,
        '</div>',
      ].join('');
    }
  );
}

export function MarkdownContent({ text, cacheKey, streaming = false }: MarkdownContentProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const html = useMemo(() => {
    const raw = marked.parse(text || '', { async: false }) as string;
    const withCodeControls = enhanceCodeBlocks(raw);
    return DOMPurify.sanitize(withCodeControls, {
      ADD_ATTR: ['data-copy-code'],
    });
  }, [text, cacheKey, streaming]);

  const handleCopy = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches('[data-copy-code="true"]')) return;

    const block = target.closest('.ozwell-code-block');
    const code = block?.querySelector('code')?.textContent || '';
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      const nextKey = `${cacheKey || 'message'}:${code.length}`;
      setCopiedKey(nextKey);
      window.setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      // Clipboard may be unavailable in embedded/sandboxed contexts.
    }
  };

  return (
    <div
      className="ozwell-markdown"
      data-copied={copiedKey ? 'true' : 'false'}
      onClick={handleCopy}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
