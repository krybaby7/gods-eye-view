import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesPerson } from './person-identity.mjs';

test('matches person names across accents, case, punctuation and suffixes', () => {
  assert.ok(matchesPerson('JOSÉ O’Neill, Jr.', 'Jose Oneill'));
  assert.ok(matchesPerson('Faisal bin Farhan Al-Saud', 'Faisal bin Farhan'));
  assert.ok(!matchesPerson('Faisal bin Salman Al Saud', 'Faisal bin Farhan'));
  assert.ok(!matchesPerson('', ''));
});

test('matches an explicitly sourced spelling alias', () => {
  assert.ok(
    matchesPerson('Raj Nath Singh', {
      name: 'Rajnath Singh',
      aliases: ['Raj Nath Singh'],
    }),
  );
});

test('requires an expected Wikidata Q-id to match even when names agree', () => {
  const expected = { name: 'Rajnath Singh', qid: 'Q123' };
  assert.ok(matchesPerson({ name: 'Raj Nath Singh', id: 'Q123' }, expected));
  assert.ok(!matchesPerson({ name: 'Rajnath Singh', id: 'Q456' }, expected));
  assert.ok(!matchesPerson('Rajnath Singh', expected));
});
