import { readFile, writeFile } from 'node:fs/promises';
import { loadWorldRegistry } from '../server/providers/world/registry.js';
import {
  resolveCiaCountry,
  resolveCiaPage,
} from '../server/providers/world/sources/cia-world-leaders.js';
import { officeRoles } from '../server/providers/world/officeholders.js';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error(
    'Usage: node scripts/world-cia-audit.mjs STATE.json AUDIT.json',
  );
  process.exitCode = 1;
} else {
  try {
    const state = JSON.parse(await readFile(input, 'utf8'));
    const cia = state.board?.features?.['cia-world-leaders'];
    if (!cia?.directory?.entries.length) {
      throw new Error('CIA country cache or directory unavailable');
    }
    const registry = await loadWorldRegistry();
    const records = cia.directory.entries.map(({ country, slug }) => {
      const page = cia.pages[slug];
      const countryCode = resolveCiaCountry(country, registry)?.iso3 ?? null;
      const officeholders = page ? resolveCiaPage(page, registry) : [];
      const roles = Object.fromEntries(
        officeRoles.map((role) => [
          role,
          officeholders
            .filter((actor) => actor.role === role)
            .map(({ name, office }) => ({ name, office })),
        ]),
      );
      return {
        country,
        countryCode,
        source:
          'https://www.cia.gov/resources/world-leaders/foreign-governments/' +
          slug +
          '/',
        cached: Boolean(page),
        asOf: page?.asOf ?? null,
        roles,
        unmappedRoles: officeRoles.filter((role) => !roles[role].length),
        multipleHolders: officeRoles.filter((role) => roles[role].length > 1),
        ...(page?.caveat && { caveat: page.caveat }),
        ...(page && {
          titles: page.leaders.map(({ title, name }) => ({
            title,
            occupied: Boolean(name),
          })),
        }),
      };
    });
    const report = {
      directoryCheckedAt: cia.directory.checkedAt,
      pull: cia.report,
      testedCountries: records.length,
      cachedPages: records.filter(({ cached }) => cached).length,
      unresolvedCountries: records
        .filter(({ countryCode }) => !countryCode)
        .map(({ country }) => country),
      missingPages: records
        .filter(({ cached }) => !cached)
        .map(({ country, source }) => ({ country, source })),
      unmappedByRole: Object.fromEntries(
        officeRoles.map((role) => [
          role,
          records
            .filter(
              ({ cached, unmappedRoles }) =>
                cached && unmappedRoles.includes(role),
            )
            .map(({ country, countryCode, source }) => ({
              country,
              countryCode,
              source,
            })),
        ]),
      ),
      records,
    };
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      `Tested title table against ${report.cachedPages} of ${records.length} listed CIA country pages.`,
    );
    for (const [role, rows] of Object.entries(report.unmappedByRole))
      console.log(
        `${role} unmapped for ${rows.length}: ${rows.map(({ country }) => country).join(', ')}`,
      );
  } catch (error) {
    const reason =
      error.code === 'ENOENT' ? 'File not found: ' + input : error.message;
    await writeFile(
      output,
      JSON.stringify({ pass: null, reason }, null, 2) + '\n',
    );
    console.log('Not measured. ' + reason);
  }
}
