import React from 'react';

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  // Enhanced markdown parser for common patterns
  const parseMarkdown = (text: string): React.ReactNode[] => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let key = 0;
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];
    let codeBlockLang = '';

    lines.forEach((line, lineIndex) => {
      // Code block start/end (```language or ```)
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.trim().substring(3).trim();
          codeBlockLines = [];
        } else {
          // End of code block
          inCodeBlock = false;
          elements.push(
            <div key={`code-${key++}`} className="my-2 rounded-md bg-muted p-3 font-mono text-xs overflow-x-auto">
              <code className="text-foreground">{codeBlockLines.join('\n')}</code>
            </div>
          );
          codeBlockLines = [];
          codeBlockLang = '';
        }
        return;
      }

      // Inside code block
      if (inCodeBlock) {
        codeBlockLines.push(line);
        return;
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={`br-${key++}`} className="h-2" />);
        return;
      }

      // Parse inline formatting
      const parseInline = (text: string): React.ReactNode[] => {
        const parts: React.ReactNode[] = [];
        let remaining = text;
        let partKey = 0;

        while (remaining.length > 0) {
          // Inline code (`code`)
          const inlineCodeMatch = remaining.match(/`([^`]+)`/);
          if (inlineCodeMatch && inlineCodeMatch.index !== undefined) {
            if (inlineCodeMatch.index > 0) {
              parts.push(remaining.substring(0, inlineCodeMatch.index));
            }
            parts.push(
              <code
                key={`inline-code-${partKey++}`}
                className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono"
              >
                {inlineCodeMatch[1]}
              </code>
            );
            remaining = remaining.substring(inlineCodeMatch.index + inlineCodeMatch[0].length);
            continue;
          }

          // Bold text (**text** or __text__)
          const boldMatch = remaining.match(/(\*\*|__)([^*_]+)\1/);
          if (boldMatch && boldMatch.index !== undefined) {
            if (boldMatch.index > 0) {
              parts.push(remaining.substring(0, boldMatch.index));
            }
            parts.push(
              <strong key={`bold-${partKey++}`} className="font-semibold">
                {boldMatch[2]}
              </strong>
            );
            remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
            continue;
          }

          // Italic text (*text* or _text_)
          const italicMatch = remaining.match(/(\*|_)([^*_]+)\1/);
          if (italicMatch && italicMatch.index !== undefined) {
            if (italicMatch.index > 0) {
              parts.push(remaining.substring(0, italicMatch.index));
            }
            parts.push(
              <em key={`italic-${partKey++}`} className="italic">
                {italicMatch[2]}
              </em>
            );
            remaining = remaining.substring(italicMatch.index + italicMatch[0].length);
            continue;
          }

          // No more special formatting
          parts.push(remaining);
          break;
        }

        return parts;
      };

      // Heading (# to ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
        const sizeClasses = {
          1: 'text-xl font-bold mt-4 mb-2',
          2: 'text-lg font-bold mt-3 mb-2',
          3: 'text-base font-bold mt-2 mb-1',
          4: 'text-sm font-semibold mt-2 mb-1',
          5: 'text-sm font-semibold mt-1',
          6: 'text-xs font-semibold mt-1',
        };
        elements.push(
          <HeadingTag key={`h${level}-${key++}`} className={sizeClasses[level as keyof typeof sizeClasses]}>
            {parseInline(headingMatch[2])}
          </HeadingTag>
        );
        return;
      }

      // Numbered list item (1. text)
      const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (numberedMatch) {
        elements.push(
          <div key={`ol-${key++}`} className="flex gap-2 ml-4 my-1">
            <span className="text-muted-foreground select-none font-medium">{numberedMatch[1]}.</span>
            <span className="flex-1">{parseInline(numberedMatch[2])}</span>
          </div>
        );
        return;
      }

      // Bullet list item (• or * or -)
      const bulletMatch = line.match(/^[•\*\-]\s+(.+)$/);
      if (bulletMatch) {
        elements.push(
          <div key={`li-${key++}`} className="flex gap-2 ml-4 my-1">
            <span className="text-muted-foreground select-none">•</span>
            <span className="flex-1">{parseInline(bulletMatch[1])}</span>
          </div>
        );
        return;
      }

      // Blockquote (> text)
      const quoteMatch = line.match(/^>\s+(.+)$/);
      if (quoteMatch) {
        elements.push(
          <div key={`quote-${key++}`} className="border-l-4 border-primary/30 pl-3 my-2 text-muted-foreground italic">
            {parseInline(quoteMatch[1])}
          </div>
        );
        return;
      }

      // Horizontal rule (--- or ***)
      if (line.match(/^(---|\*\*\*)$/)) {
        elements.push(<hr key={`hr-${key++}`} className="my-3 border-border" />);
        return;
      }

      // Regular paragraph
      elements.push(
        <p key={`p-${key++}`} className="my-1 leading-relaxed">
          {parseInline(line)}
        </p>
      );
    });

    return elements;
  };

  return <div className="text-sm space-y-0.5">{parseMarkdown(content)}</div>;
};
