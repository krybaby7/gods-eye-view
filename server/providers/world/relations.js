export function makeRelation(fields) {
  return {
    directed: false,
    start: null,
    end: null,
    conditions: null,
    evidence: 'documented',
    ...fields,
  };
}

function comparable({ retrievedAt, dateChecked, ...row }) {
  return JSON.stringify(row);
}

export function relationResult(relations, previous, name, detail) {
  const before = new Map(
    (previous?.relations ?? []).map((row) => [row.id, comparable(row)]),
  );
  const after = new Map(relations.map((row) => [row.id, comparable(row)]));
  const added = [...after.keys()].filter((id) => !before.has(id)).length;
  const removed = [...before.keys()].filter((id) => !after.has(id)).length;
  const updated = [...after].filter(
    ([id, row]) => before.has(id) && before.get(id) !== row,
  ).length;
  return {
    data: { relations },
    count: relations.length,
    unit: 'relation',
    detail,
    changes:
      added || removed || updated
        ? [
            {
              iso3: null,
              text:
                name +
                ' relations changed (' +
                added +
                ' added, ' +
                removed +
                ' removed, ' +
                updated +
                ' updated).',
            },
          ]
        : [],
  };
}
