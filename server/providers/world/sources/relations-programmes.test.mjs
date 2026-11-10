import assert from 'node:assert/strict';
import test from 'node:test';
import observed from './fixtures/relations-programme-keys.json' with { type: 'json' };
import { programmeRelations } from './relationsSanctions.js';

test('every tag in the downloaded OFAC and UK programme inventories is mapped or thematic', async () => {
  const ofac = observed.ofac.programmes
    .map(
      (tag, index) =>
        `${index + 1},fixture,Entity,"${tag}",-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-`,
    )
    .join('\n');
  const uk =
    '<office:document-content><office:body><office:text>' +
    '<text:p>UK SANCTIONS LIST PUBLICATION</text:p>' +
    observed.uk.programmes
      .map(
        (name, i) =>
          '<text:p><text:span>' +
          name.replaceAll('&', '&amp;') +
          '</text:span></text:p><text:p>ENTITY</text:p><text:p>1.</text:p>' +
          '<text:p><text:span>Primary Name:</text:span><text:span>Fixture</text:span>' +
          '<text:span>Unique Id:</text:span><text:span>TST' +
          i +
          '</text:span></text:p>',
      )
      .join('') +
    '</office:text></office:body></office:document-content>';
  for (const [kind, content] of [
    ['ofac', ofac],
    ['uk', [Buffer.from(uk)]],
  ]) {
    const { relations, coverage } = await programmeRelations(
      kind,
      content,
      '2026-11-06',
    );
    assert.deepEqual(coverage.unmapped, [], kind);
    assert.equal(
      coverage.mappedProgrammes + coverage.thematicProgrammes,
      observed[kind].programmes.length,
    );
    assert.ok(
      relations.every(
        ({ scope, dateChecked, sources }) =>
          ['state', 'persons', 'targeted'].includes(scope) &&
          dateChecked === '2026-11-06' &&
          sources[0].startsWith('https:'),
      ),
    );
  }
});
