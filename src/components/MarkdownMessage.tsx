import React from 'react';

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  // Simple markdown parser for common patterns
  const parseMarkdown = (text: string): React.ReactNode[] => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let key = 0;

    lines.forEach((line, lineIndex) => {
      // Empty line
      if (line.trim() === '') {
        elements.push(<br key={`br-${key++}`} />);
        return;
      }

      // Parse inline formatting
      const parseInline = (text: string): React.ReactNode[] => {
        const parts: React.ReactNode[] = [];
        let remaining = text;
        let partKey = 0;

        while (remaining.length > 0) {
          // Bold text (**text**)
          const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
          if (boldMatch && boldMatch.index !== undefined) {
            // Add text before bold
            if (boldMatch.index > 0) {
              parts.push(remaining.substring(0, boldMatch.index));
            }
            // Add bold text
            parts.push(
              <strong key={`bold-${partKey++}`} className="font-semibold">
                {boldMatch[1]}
              </strong>
            );
            remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
            continue;
          }

          // No more special formatting
          parts.push(remaining);
          break;
        }

        return parts;
      };

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

      // Regular paragraph
      elements.push(
        <p key={`p-${key++}`} className="my-1">
          {parseInline(line)}
        </p>
      );
    });

    return elements;
  };

  return <div className="text-sm space-y-1">{parseMarkdown(content)}</div>;
};
