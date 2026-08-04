const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findHttpUrls,
  highlightedTextWithLinks,
  highlightPlainSegment,
  looksLikeCode,
} = require('../public/highlight');

test('highlightPlainSegment escapes text when code highlighting is off', () => {
  assert.equal(
    highlightPlainSegment('<script>alert("x")</script>', false),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );
});

test('highlightPlainSegment highlights code tokens without unescaped user HTML', () => {
  const html = highlightPlainSegment('const x = "<tag>"; // comment', true);

  assert.match(html, /<span class="tok-keyword">const<\/span>/);
  assert.match(html, /<span class="tok-string">&quot;&lt;tag&gt;&quot;<\/span>/);
  assert.match(html, /<span class="tok-comment">\/\/ comment<\/span>/);
  assert.doesNotMatch(html, /<tag>/);
});

test('highlightedTextWithLinks preserves links and escapes surrounding text', () => {
  const result = highlightedTextWithLinks('const url = https://example.com/path\n<b>');

  assert.equal(result.asCode, true);
  assert.match(result.html, /<a href="https:\/\/example\.com\/path"/);
  assert.match(result.html, /&lt;b&gt;/);
  assert.doesNotMatch(result.html, /<b>/);
});

test('URL detection leaves shell and sentence punctuation outside links', () => {
  const source = '/bin/bash -c "$(curl https://example.com/install.sh)"; see https://example.com/docs.';
  const matches = findHttpUrls(source);

  assert.deepEqual(matches.map(match => match.url), [
    'https://example.com/install.sh',
    'https://example.com/docs',
  ]);
  const result = highlightedTextWithLinks(source);
  assert.match(result.html, /href="https:\/\/example\.com\/install\.sh"/);
  assert.doesNotMatch(result.html, /href="https:\/\/example\.com\/install\.sh\)/);
  assert.doesNotMatch(result.html, /href="https:\/\/example\.com\/docs\./);
});

test('URL detection preserves balanced parentheses in a URL', () => {
  assert.deepEqual(
    findHttpUrls('https://example.com/wiki/Function_(math)').map(match => match.url),
    ['https://example.com/wiki/Function_(math)'],
  );
});

test('looksLikeCode detects common code snippets', () => {
  assert.equal(looksLikeCode('const answer = 42;'), true);
  assert.equal(looksLikeCode('plain note without code markers'), false);
});

test('highlight helpers coerce non-string input safely', () => {
  assert.equal(highlightPlainSegment(42, false), '42');
  assert.equal(looksLikeCode(null), false);
});
