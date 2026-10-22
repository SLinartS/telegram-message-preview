import { parseMarkdown, parseHtml, plainText, toHtml } from './formatter.js';

const $ = (selector) => document.querySelector(selector);
const source = $('#source');
const sampleMarkdown = '*Небольшой текст. Большая разница.* ✨\n\nЗдесь можно выделить _главное_, __подчеркнуть мысль__ и ~вычеркнуть лишнее~.\n\nА ещё — спрятать ||маленький секрет|| и добавить [полезную ссылку](https://telegram.org).\n\n> Хорошее сообщение начинается с хорошего черновика.\n\nКод тоже на месте: `const hello = "world";`\n\nВсё готово к отправке 🚀';
const sampleHtml = '<b>Небольшой текст. Большая разница.</b> ✨\n\nЗдесь можно выделить <i>главное</i>, <u>подчеркнуть мысль</u> и <s>вычеркнуть лишнее</s>.\n\nА ещё — спрятать <tg-spoiler>маленький секрет</tg-spoiler> и добавить <a href="https://telegram.org">полезную ссылку</a>.\n\n<blockquote>Хорошее сообщение начинается с хорошего черновика.</blockquote>\n\nКод тоже на месте: <code>const hello = "world";</code>\n\nВсё готово к отправке 🚀';
// Keep the original key so existing drafts survive the project rename.
const storageKey = 'tg-formatter-draft-v1';
let mode = 'markdown';
let dark = false;
let htmlOutput = '';
let saveTimer;
let toastTimer;

try {
  const draft = JSON.parse(localStorage.getItem(storageKey));
  if (draft && typeof draft.text === 'string') {
    source.value = draft.text;
    if (['markdown', 'html', 'plain'].includes(draft.mode)) mode = draft.mode;
    dark = draft.dark === true;
  } else source.value = sampleMarkdown;
} catch { source.value = sampleMarkdown; }

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ text: source.value, mode, dark }));
    $('#save-status').textContent = 'Черновик сохранён в браузере';
  } catch { $('#save-status').textContent = 'Автосохранение недоступно'; }
}

function renderNodes(nodes, parent, autoLinks = true) {
  const tags = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', pre: 'pre', quote: 'blockquote', link: 'a', spoiler: 'button' };
  for (const node of nodes) {
    if (node.type === 'text') {
      // Telegram auto-detects web links even without explicit markup.
      if (autoLinks) {
        const pieces = node.text.split(/(https?:\/\/[^\s<>]+)/g);
        for (const piece of pieces) {
          if (/^https?:\/\//.test(piece)) {
            const clean = piece.replace(/[.,!?;:)\]]+$/, '');
            const link = document.createElement('a');
            link.href = clean; link.textContent = clean; link.target = '_blank'; link.rel = 'noopener noreferrer';
            parent.append(link, piece.slice(clean.length));
          } else parent.append(document.createTextNode(piece));
        }
      } else parent.append(document.createTextNode(node.text));
      continue;
    }
    const element = document.createElement(tags[node.type] || 'span');
    if (node.type === 'link') { element.href = node.url; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    if (node.type === 'spoiler') {
      element.type = 'button'; element.className = 'spoiler'; element.setAttribute('aria-label', 'Показать спойлер'); element.setAttribute('aria-expanded', 'false');
      element.addEventListener('click', () => {
        const revealed = element.classList.toggle('revealed');
        element.setAttribute('aria-expanded', String(revealed));
        element.setAttribute('aria-label', revealed ? 'Скрыть спойлер' : 'Показать спойлер');
      });
    }
    if (node.type === 'pre' && node.language) element.dataset.language = node.language;
    if (node.type === 'quote' && node.expandable) {
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Развернуть цитату';
      details.append(summary, element); parent.append(details);
    } else parent.append(element);
    renderNodes(node.children, element, autoLinks && !['link', 'code', 'pre', 'spoiler'].includes(node.type));
  }
}

function update() {
  const result = mode === 'html' ? parseHtml(source.value) : mode === 'plain' ? { nodes: [{ type: 'text', text: source.value }], warnings: [] } : parseMarkdown(source.value);
  const rendered = $('#rendered');
  rendered.replaceChildren();
  renderNodes(result.nodes, rendered);
  const length = plainText(result.nodes).length;
  const count = new Intl.NumberFormat('ru-RU');
  $('#raw-count').textContent = `${count.format(source.value.length)} симв. в исходнике`;
  $('#message-count').textContent = `${count.format(length)} / 4 096`;
  $('#message-count').classList.toggle('over-limit', length > 4096);
  $('#message').hidden = !source.value;
  $('#empty-preview').hidden = !!source.value;
  htmlOutput = toHtml(result.nodes);
  $('#html-output').textContent = htmlOutput || 'Здесь появится HTML вашего сообщения';
  if (length > 4096) result.warnings.push('Сообщение длиннее 4 096 символов после форматирования. Для sendMessage его нужно разделить.');
  $('#warnings').hidden = !result.warnings.length;
  $('#warnings').textContent = result.warnings.join(' ');
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 250);
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  document.querySelectorAll('[data-format]').forEach((button) => { button.disabled = mode === 'plain'; });
  const hint = $('#syntax-hint');
  hint.replaceChildren();
  const samples = mode === 'markdown' ? ['*жирный*', '_курсив_', '__подчёркнутый__', '||спойлер||'] : mode === 'html' ? ['<b>жирный</b>', '<i>курсив</i>', '<tg-spoiler>спойлер</tg-spoiler>'] : ['Без разметки — текст как есть'];
  for (const text of samples) { const code = document.createElement('code'); code.textContent = text; hint.append(code); }
  update();
}

function showToast(text) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2500);
}

function insertFormat(format) {
  if (mode === 'plain') return;
  const start = source.selectionStart;
  const end = source.selectionEnd;
  const selection = source.value.slice(start, end) || 'текст';
  const markdown = { bold: ['*', '*'], italic: ['_', '_'], underline: ['__', '__'], strike: ['~', '~'], code: ['`', '`'], spoiler: ['||', '||'], link: ['[', '](https://example.com)'], quote: ['> ', ''] };
  const html = { bold: ['<b>', '</b>'], italic: ['<i>', '</i>'], underline: ['<u>', '</u>'], strike: ['<s>', '</s>'], code: ['<code>', '</code>'], spoiler: ['<tg-spoiler>', '</tg-spoiler>'], link: ['<a href="https://example.com">', '</a>'], quote: ['<blockquote>', '</blockquote>'] };
  const [before, after] = (mode === 'html' ? html : markdown)[format];
  let value = before + selection + after;
  if (format === 'quote' && mode === 'markdown') value = selection.split('\n').map((line) => '> ' + line).join('\n');
  source.setRangeText(value, start, end, 'select');
  source.focus();
  source.setSelectionRange(start + before.length, start + value.length - after.length);
  update();
}

function setTheme() {
  $('#chat').classList.toggle('dark', dark);
  $('#theme').setAttribute('aria-pressed', String(dark));
  $('#theme').textContent = dark ? '☀ Светлая' : '☾ Тёмная';
}

source.addEventListener('input', update);
source.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
    event.preventDefault(); insertFormat(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
  }
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-format]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => insertFormat(button.dataset.format));
});
$('#sample').addEventListener('click', () => {
  source.value = mode === 'html' ? sampleHtml : mode === 'plain' ? 'Привет! Это обычное сообщение без разметки.\n\nВставьте свой текст и посмотрите, как он будет выглядеть в Telegram. 🚀' : sampleMarkdown;
  update();
});
$('#clear').addEventListener('click', () => { source.value = ''; update(); source.focus(); });
$('#theme').addEventListener('click', () => { dark = !dark; setTheme(); save(); });
$('#copy-html').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(htmlOutput); showToast('HTML скопирован'); }
  catch { showToast('Не удалось скопировать. Выделите HTML и нажмите Ctrl+C.'); }
});
$('#message-time').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date());
setTheme();
setMode(mode);
