const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesComment, parseKeywords, normalize } = require('../src/lib/keywords');

test('normalize trims, collapses space, lowercases, and keeps Hebrew', () => {
  assert.equal(normalize('  הכנה  '), 'הכנה');
  assert.equal(normalize('Hello   THERE'), 'hello there');
});

test('parseKeywords splits on commas', () => {
  assert.deepEqual(parseKeywords('הכנה, מתכון, אני רוצה'), ['הכנה', 'מתכון', 'אני רוצה']);
});

test('any mode always matches', () => {
  assert.equal(matchesComment({ text: '', keywordMode: 'any' }), true);
  assert.equal(matchesComment({ text: 'שלום', keywordMode: 'any' }), true);
});

test('whole word matches Hebrew keyword and ignores surrounding punctuation', () => {
  const opts = { keywordMode: 'keywords', keywords: 'הכנה, מתכון', matchType: 'whole_word' };
  assert.equal(matchesComment({ text: 'הכנה', ...opts }), true);
  assert.equal(matchesComment({ text: 'רוצה הכנה בבקשה', ...opts }), true);
  assert.equal(matchesComment({ text: 'הכנה!', ...opts }), true);
  assert.equal(matchesComment({ text: 'הכנה.', ...opts }), true);
  assert.equal(matchesComment({ text: 'להכנה', ...opts }), false);
});

test('contains matches inside a longer token', () => {
  const opts = { keywordMode: 'keywords', keywords: 'הכנה', matchType: 'contains' };
  assert.equal(matchesComment({ text: 'להכנה', ...opts }), true);
  assert.equal(matchesComment({ text: 'מתכון', ...opts }), false);
});

test('matching is case and whitespace insensitive', () => {
  const opts = { keywordMode: 'keywords', keywords: 'Recipe', matchType: 'whole_word' };
  assert.equal(matchesComment({ text: '  RECIPE  ', ...opts }), true);
});
