import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { memo } from "react";

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName: string; hProperties: { className: string } };
}
/** Opt-in inline {{...}} groups. Never parse code, URLs, raw HTML or math source. */
export function remarkRecall() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (!node.children || ["code", "inlineCode", "math", "inlineMath", "html", "link", "linkReference"].includes(node.type)) return;
      node.children.forEach(visit);
      if (!["paragraph", "heading", "tableCell"].includes(node.type)) return;
      const result: Node[] = [];
      let group: Node[] | undefined;
      let invalid = false;
      const append = (child: Node) => (group || result).push(child);
      for (const child of node.children) {
        if (child.type !== "text") { append(child); continue; }
        for (const part of (child.value || "").split(/(\{\{|\}\})/)) {
          if (part === "{{") {
            if (group) { invalid = true; break; }
            group = [];
          } else if (part === "}}") {
            if (!group) { invalid = true; break; }
            result.push({ type: "recall", children: group, data: { hName: "span", hProperties: { className: "recall-mask" } } });
            group = undefined;
          } else if (part) append({ type: "text", value: part });
        }
        if (invalid) break;
      }
      // Malformed annotations stay visible; never accidentally hide the rest of a card.
      if (!invalid && !group) node.children = result;
    };
    visit(tree);
  };
}
export const MaskedMarkdown = memo(function MaskedMarkdown({ content, revealed }: { content: string; revealed: boolean }) {
  return <article className="markdown panel">
    <Markdown remarkPlugins={[remarkGfm, remarkMath, remarkRecall]}
      rehypePlugins={[[rehypeKatex, { strict: false, trust: false }]]}
      components={{
        img: () => null,
        span: ({ node: _node, children, className, ...props }) => className === "recall-mask" && !revealed
          ? <span className="recall-mask concealed" aria-label="背诵内容已遮住"><span aria-hidden="true">{children}</span></span>
          : <span {...props} className={className}>{children}</span>,
        a: ({ children, href }) => /^https?:\/\//.test(href || "")
          ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      }}>{content}</Markdown>
  </article>;
});
