import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders author markdown: code blocks, images, tables. Raw HTML in the text is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
