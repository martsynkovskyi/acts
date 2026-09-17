'use strict';
(() => {
  function normalizeQuotes(value) {
    let depth = 0;
    let result = '';
    for (const char of String(value ?? '')) {
      if (char === '«' || char === '“' || char === '„') { result += '«'; depth += 1; }
      else if (char === '»' || char === '”') { result += '»'; depth = Math.max(0, depth - 1); }
      else if (char === '"') {
        if (depth) { result += '»'; depth -= 1; }
        else { result += '«'; depth += 1; }
      } else result += char;
    }
    return result;
  }

  function normalizeInput(input) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    if (input instanceof HTMLInputElement && !['text', 'search'].includes(input.type)) return;
    const next = normalizeQuotes(input.value);
    if (next === input.value) return;
    const start = input.selectionStart, end = input.selectionEnd;
    input.value = next;
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  }

  window.__ACTS_NORMALIZE_QUOTES__ = normalizeQuotes;
  document.addEventListener('input', event => { if (!event.isComposing) normalizeInput(event.target); }, true);
  document.addEventListener('change', event => normalizeInput(event.target), true);
  document.addEventListener('compositionend', event => normalizeInput(event.target), true);
})();
