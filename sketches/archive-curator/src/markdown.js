// Deliberately tiny markdown renderer for notes: headings, bold/italic,
// inline + fenced code, links, lists, quotes, rules. HTML is escaped first,
// so notes can never inject markup.
(function () {
  const C = (window.Curator = window.Curator || {});

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + codes[+i] + "</code>");
  }

  function render(src) {
    const lines = esc(src || "").split("\n");
    const out = [];
    let para = [];
    let list = null; // { tag, items }
    const flushPara = () => {
      if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
      para = [];
    };
    const flushList = () => {
      if (list) out.push("<" + list.tag + ">" + list.items.map((i) => "<li>" + inline(i) + "</li>").join("") + "</" + list.tag + ">");
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^```/.test(line)) {
        flushPara();
        flushList();
        const code = [];
        while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
        out.push("<pre><code>" + code.join("\n") + "</code></pre>");
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara();
        flushList();
        out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">");
      } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        flushPara();
        flushList();
        out.push("<hr>");
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        const tag = /^\s*\d/.test(line) ? "ol" : "ul";
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push(m[1]);
      } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
        flushPara();
        flushList();
        out.push("<blockquote>" + inline(m[1]) + "</blockquote>");
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
    return out.join("\n");
  }

  C.markdown = { render, esc };
})();
