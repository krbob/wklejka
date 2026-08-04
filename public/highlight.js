(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WklejkaHighlight = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function looksLikeCode(text) {
    const source = String(text);
    const lines = source.split('\n');
    return /```|<\/?[a-z][\s\S]*>|[{};]/i.test(source)
      || /\b(function|const|let|var|return|class|import|export|async|await|def|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE)\b/.test(source)
      || lines.filter(line => /^\s{2,}\S/.test(line)).length >= 2;
  }

  function highlightTokenClass(token) {
    if (/^(\/\/|\/\*|#)/.test(token)) return 'tok-comment';
    if (/^["'`]/.test(token)) return 'tok-string';
    if (/^\d/.test(token)) return 'tok-number';
    return 'tok-keyword';
  }

  function highlightPlainSegment(segment, asCode) {
    const source = String(segment);
    if (!asCode) return escapeHtml(source);

    const keywords = [
      'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default',
      'delete', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if',
      'import', 'in', 'let', 'new', 'null', 'return', 'select', 'throw', 'true', 'try', 'undefined',
      'var', 'while', 'where', 'insert', 'update', 'create', 'drop', 'join', 'from',
    ].join('|');
    const tokenRe = new RegExp(`(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|#[^\\n]*|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\\`(?:\\\\.|[^\\\`\\\\])*\\\`|\\b(?:${keywords})\\b|\\b\\d+(?:\\.\\d+)?\\b)`, 'gi');

    let output = '';
    let lastIndex = 0;
    let match;
    while ((match = tokenRe.exec(source)) !== null) {
      output += escapeHtml(source.slice(lastIndex, match.index));
      const token = match[0];
      output += `<span class="${highlightTokenClass(token)}">${escapeHtml(token)}</span>`;
      lastIndex = tokenRe.lastIndex;
    }
    output += escapeHtml(source.slice(lastIndex));
    return output;
  }

  function trimUrlEnd(value) {
    let url = String(value).replace(/[.,;:!?]+$/g, '');
    const pairs = { ')': '(', ']': '[', '}': '{' };
    let changed = true;
    while (changed && url) {
      changed = false;
      const closing = url.at(-1);
      const opening = pairs[closing];
      if (!opening) continue;
      const openingCount = [...url].filter(character => character === opening).length;
      const closingCount = [...url].filter(character => character === closing).length;
      if (closingCount > openingCount) {
        url = url.slice(0, -1).replace(/[.,;:!?]+$/g, '');
        changed = true;
      }
    }
    return url;
  }

  function findHttpUrls(text) {
    const source = String(text);
    const urlRe = /https?:\/\/[^\s<>"']+/g;
    const matches = [];
    let match;
    while ((match = urlRe.exec(source)) !== null) {
      const url = trimUrlEnd(match[0]);
      if (!url) continue;
      matches.push({
        url,
        index: match.index,
        end: match.index + url.length,
      });
    }
    return matches;
  }

  function highlightedTextWithLinks(text) {
    const source = String(text);
    const asCode = looksLikeCode(source);
    let output = '';
    let lastIndex = 0;
    for (const match of findHttpUrls(source)) {
      output += highlightPlainSegment(source.slice(lastIndex, match.index), asCode);
      const { url } = match;
      output += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
      lastIndex = match.end;
    }
    output += highlightPlainSegment(source.slice(lastIndex), asCode);
    return { html: output, asCode };
  }

  return {
    escapeHtml,
    findHttpUrls,
    highlightedTextWithLinks,
    highlightPlainSegment,
    highlightTokenClass,
    looksLikeCode,
  };
});
