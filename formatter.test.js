import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, plainText, toHtml, safeUrl } from './formatter.js';

test('Telegram formatting and nested entities', () => {
  const { nodes } = parseMarkdown('*Жирный _курсив_* __линия__ ~нет~ ||секрет||');
  assert.equal(toHtml(nodes), '<b>Жирный <i>курсив</i></b> <u>линия</u> <s>нет</s> <tg-spoiler>секрет</tg-spoiler>');
  assert.equal(plainText(nodes), 'Жирный курсив линия нет секрет');
});
test('escaped markers and unfinished formatting stay literal', () => {
  assert.equal(toHtml(parseMarkdown('\\*не жирный\\* *не закрыт').nodes), '*не жирный* *не закрыт');
});
test('common double-star bold and double-tilde strike work for pasted drafts', () => {
  assert.equal(toHtml(parseMarkdown('**bold** and ~~old~~').nodes), '<b>bold</b> and <s>old</s>');
});
test('code content is inert and not formatted', () => {
  assert.equal(toHtml(parseMarkdown('```js\nconst a = "<b>";\n```').nodes), '<pre><code class="language-js">const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  assert.equal(toHtml(parseMarkdown('`*literal*`').nodes), '<code>*literal*</code>');
});
test('quotes preserve line breaks and following text', () => {
  const result = parseMarkdown('> one\n> *two*\n\nend');
  assert.equal(toHtml(result.nodes), '<blockquote>one\n<b>two</b></blockquote>\n\nend');
});
test('links support Telegram URLs, escaped parentheses and reject executable URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('java\nscript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,test'), null);
  assert.equal(safeUrl('tg://user?id=123'), 'tg://user?id=123');
  assert.equal(toHtml(parseMarkdown('[x](https://example.com/a\\))').nodes), '<a href="https://example.com/a)">x</a>');
  const unsafe = parseMarkdown('[click](javascript:evil)');
  assert.equal(toHtml(unsafe.nodes), 'click');
  assert.equal(unsafe.warnings.length, 1);
});
test('pasted HTML in Markdown is displayed as text', () => {
  assert.equal(toHtml(parseMarkdown('<img src=x onerror=alert(1)>').nodes), '&lt;img src=x onerror=alert(1)&gt;');
});
test('pathological nesting cannot freeze the editor', () => {
  const input = '*_~||__abc'.repeat(100);
  const result = parseMarkdown(input);
  assert.ok(result.nodes.length > 0);
  assert.ok(result.warnings.length > 0);
  const deepQuote = parseMarkdown('>'.repeat(2000) + ' end');
  assert.ok(deepQuote.warnings.length > 0);
});
