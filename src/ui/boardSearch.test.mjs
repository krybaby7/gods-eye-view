import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeDocument } from '../testSupport/fakeDocument.mjs';
import { createBoardSearch } from './boardSearch.js';

function searchFixture({
  getModel = () => ({}),
  activate = () => true,
  lookup,
}) {
  const document = createFakeDocument();
  const make = (id, tag, parent) => {
    const node = document.createElement(tag);
    node.id = id;
    parent.append(node);
    return node;
  };
  const root = make('frame-search', 'div', document.body);
  const input = make('frame-search-input', 'input', root);
  const popup = make('frame-search-popup', 'div', root);
  popup.hidden = true;
  const list = make('frame-search-list', 'div', popup);
  const status = make('frame-search-status', 'div', popup);
  const controller = createBoardSearch({
    document,
    getModel,
    activate,
    lookup,
  });
  input.focus();
  return {
    document,
    input,
    status,
    controller,
    type(text) {
      input.value = text;
      input.dispatchEvent({ type: 'input' });
    },
    enter() {
      input.dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        preventDefault() {},
      });
    },
  };
}

test('an explicit keyless lookup distinguishes a zero result from unavailability', async () => {
  const requests = [];
  const f = searchFixture({
    async lookup(query) {
      requests.push(query);
      return { place: null, answered: query === 'Glendu' };
    },
  });
  f.type('Glendu');
  assert.deepEqual(requests, []);
  f.enter();
  await Promise.resolve();
  assert.equal(f.status.textContent, 'No city or country found.');
  assert.equal(f.input.value, 'Glendu');

  f.type('East Vale');
  f.enter();
  await Promise.resolve();
  assert.equal(f.status.textContent, 'Place lookup is unavailable. Try again.');
  assert.equal(f.input.value, 'East Vale');
  assert.equal(f.document.activeElement, f.input);
  assert.deepEqual(requests, ['Glendu', 'East Vale']);
  f.controller.destroy();
});

test('a disappearing local match reports its unavailability without triggering lookup', () => {
  let available = true;
  const f = searchFixture({
    getModel: () => ({
      countries: available ? { IND: { name: 'India' } } : {},
    }),
    activate: () => available,
    lookup: () => assert.fail('Local activation must not trigger a lookup'),
  });

  f.type('India');
  available = false;
  f.enter();
  assert.equal(
    f.status.textContent,
    'This board result is no longer available.',
  );
  assert.equal(f.input.value, 'India');
  assert.equal(f.document.activeElement, f.input);
  f.controller.destroy();
});

test('typing a new query aborts and ignores a pending place lookup', async () => {
  let pending;
  let requested;
  const f = searchFixture({
    activate: () => assert.fail('An abandoned result must not activate'),
    lookup(_query, { signal }) {
      requested = signal;
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
  });
  f.type('East Vale');
  f.enter();
  f.type('West Vale');
  assert.equal(requested.aborted, true);
  pending({
    answered: true,
    place: { name: 'East Vale', lat: 10, lng: 20, types: ['locality'] },
  });
  await Promise.resolve();
  assert.equal(f.input.value, 'West Vale');
  assert.match(f.status.textContent, /Press Enter/u);
  f.controller.destroy();
});
