// A small Telegram-style parser. No raw source is inserted into the page as HTML.
const textNode = (text) => ({ type: 'text', text });
const markers = [['**', 'bold'], ['~~', 'strike'], ['__', 'underline'], ['||', 'spoiler'], ['*', 'bold'], ['_', 'italic'], ['~', 'strike']];

export function safeUrl(value) {
  if (/[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'tg:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function findUnescaped(text, token, start) {
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text.startsWith(token, i)) return i;
  }
  return -1;
}

export function parseMarkdown(source, nesting = 0, budget = { remaining: Math.min(200000, Math.max(10000, source.length * 12)) }) {
  source = source.replace(/\r\n?/g, '\n');
  if (nesting > 24 || source.length > 100000) {
    return { nodes: [textNode(source)], warnings: ['Очень длинная или глубоко вложенная разметка показана обычным текстом.'] };
  }
  const warnings = [];
  function parse(start = 0, closing = '', depth = 0) {
    const nodes = [];
    let buffer = '';
    const flush = () => { if (buffer) { nodes.push(textNode(buffer)); buffer = ''; } };
    let i = start;
    while (i < source.length) {
      if (--budget.remaining < 0) throw new RangeError('Formatting budget exceeded');
      if (closing && source.startsWith(closing, i)) {
        flush();
        return { nodes, end: i + closing.length, closed: true };
      }
      if (source[i] === '\\' && i + 1 < source.length && /[\x01-\x7e]/.test(source[i + 1])) {
        buffer += source[i + 1]; i += 2; continue;
      }
      if (source.startsWith('```', i)) {
        const end = findUnescaped(source, '```', i + 3);
        if (end !== -1) {
          flush();
          let content = source.slice(i + 3, end);
          let language = '';
          const header = content.match(/^([\w+-]*)\n/);
          if (header) { language = header[1]; content = content.slice(header[0].length); }
          if (content.endsWith('\n')) content = content.slice(0, -1);
          nodes.push({ type: 'pre', language, children: [textNode(content.replace(/\\([`\\])/g, '$1'))] });
          i = end + 3; continue;
        }
      }
      if (source[i] === '`') {
        const end = findUnescaped(source, '`', i + 1);
        if (end !== -1) {
          flush(); nodes.push({ type: 'code', children: [textNode(source.slice(i + 1, end).replace(/\\([`\\])/g, '$1'))] });
          i = end + 1; continue;
        }
      }
      if (depth < 24 && source[i] === '>' && (i === 0 || source[i - 1] === '\n')) {
        const quote = source.slice(i).match(/^(?:>[^\n]*(?:\n|$))+/)[0];
        const content = quote.replace(/^> ?/gm, '').replace(/\n$/, '');
        flush();
        const result = parseMarkdown(content, nesting + 1, budget);
        warnings.push(...result.warnings);
        nodes.push({ type: 'quote', children: result.nodes });
        if (quote.endsWith('\n')) nodes.push(textNode('\n'));
        i += quote.length; continue;
      }
      if (depth < 24 && source[i] === '[') {
        const labelEnd = findUnescaped(source, '](', i + 1);
        if (labelEnd !== -1) {
          // Parentheses inside URLs must be escaped, as in MarkdownV2.
          const end = findUnescaped(source, ')', labelEnd + 2);
          if (end !== -1) {
            const url = safeUrl(source.slice(labelEnd + 2, end).replace(/\\([)\\])/g, '$1'));
            flush();
            const result = parseMarkdown(source.slice(i + 1, labelEnd), nesting + 1, budget);
            warnings.push(...result.warnings);
            const children = result.nodes;
            if (url) nodes.push({ type: 'link', url, children });
            else { nodes.push(...children); warnings.push('Небезопасная или некорректная ссылка отключена.'); }
            i = end + 1; continue;
          }
        }
      }
      const marker = depth < 24 && markers.find(([token]) => source.startsWith(token, i));
      if (marker) {
        const [token, type] = marker;
        if (findUnescaped(source, token, i + token.length) === -1) {
          buffer += token; i += token.length; continue;
        }
        const result = parse(i + token.length, token, depth + 1);
        if (result.closed) {
          flush(); nodes.push({ type, children: result.nodes }); i = result.end; continue;
        }
        buffer += token; i += token.length; continue;
      }
      buffer += source[i++];
    }
    flush();
    return { nodes, end: i, closed: !closing };
  }
  try {
    const { nodes } = parse();
    return { nodes, warnings: [...new Set(warnings)] };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { nodes: [textNode(source)], warnings: ['Слишком сложная разметка показана обычным текстом.'] };
  }
}

export const plainText = (nodes) => nodes.map((node) => node.type === 'text' ? node.text : plainText(node.children)).join('');
export const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function toHtml(nodes) {
  const tags = { bold: 'b', italic: 'i', underline: 'u', strike: 's', spoiler: 'tg-spoiler', code: 'code', quote: 'blockquote' };
  return nodes.map((node) => {
    if (node.type === 'text') return escapeHtml(node.text);
    const content = toHtml(node.children);
    if (node.type === 'link') return `<a href="${escapeHtml(node.url)}">${content}</a>`;
    if (node.type === 'pre') return `<pre><code${node.language ? ` class="language-${escapeHtml(node.language)}"` : ''}>${content}</code></pre>`;
    if (node.type === 'quote' && node.expandable) return `<blockquote expandable>${content}</blockquote>`;
    const tag = tags[node.type];
    return tag ? `<${tag}>${content}</${tag}>` : content;
  }).join('');
}

// DOMParser is used only in an inert document; every displayed node is recreated.
export function parseHtml(source) {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const warnings = new Set();
  const tags = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', ins: 'underline', s: 'strike', strike: 'strike', del: 'strike', 'tg-spoiler': 'spoiler', code: 'code', pre: 'pre', a: 'link', blockquote: 'quote' };
  function walk(parent, depth = 0) {
    if (depth > 24) { warnings.add('Слишком глубокая вложенность HTML: часть разметки показана текстом.'); return [textNode(parent.textContent)]; }
    return [...parent.childNodes].flatMap((node) => {
      if (node.nodeType === 3) return [textNode(node.textContent)];
      if (node.nodeType !== 1) return [];
      const tag = node.localName;
      const type = tag === 'span' && node.classList.contains('tg-spoiler') ? 'spoiler' : tags[tag];
      if (['script', 'style', 'iframe', 'object', 'svg', 'math', 'template'].includes(tag)) {
        warnings.add(`Тег <${tag}> не поддерживается Telegram и исключён.`); return [];
      }
      if (tag === 'br') { warnings.add('В Telegram HTML используйте перенос строки вместо <br>.'); return [textNode('\n')]; }
      if (!type) {
        warnings.add(`Тег <${tag}> не поддерживается; показан только его текст.`);
        return walk(node, depth + 1);
      }
      if (type === 'code' || type === 'pre') {
        const language = type === 'pre' ? node.querySelector('code')?.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] || '' : '';
        return [{ type, language, children: [textNode(node.textContent)] }];
      }
      const children = walk(node, depth + 1);
      if (type === 'link') {
        const url = safeUrl(node.getAttribute('href') || '');
        if (!url) { warnings.add('Небезопасная или некорректная ссылка отключена.'); return children; }
        return [{ type, url, children }];
      }
      return [{ type, children, ...(type === 'quote' ? { expandable: node.hasAttribute('expandable') } : {}) }];
    });
  }
  const nodes = walk(doc.body);
  return { nodes, warnings: [...warnings] };
}
