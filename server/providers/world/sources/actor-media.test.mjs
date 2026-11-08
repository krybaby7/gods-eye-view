import assert from 'node:assert/strict';
import test from 'node:test';

const now = new Date('2026-11-09T12:00:00Z');
const portrait = (name, licence, thumburl, artist) => ({
  title: 'File:' + name,
  imageinfo: [
    {
      thumburl,
      descriptionurl:
        'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(name),
      extmetadata: {
        LicenseShortName: { value: licence },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
        Artist: { value: artist },
      },
    },
  ],
});
const thumb =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Fixture.jpg/120px-Fixture.jpg';
const json = (body, init) => new Response(JSON.stringify(body), init);

test('Commons uses attributed, free thumbnails and skips unusable metadata', async () => {
  const { fetchObservations } = await import('./wikimedia-commons.js');
  const { data, count } = await fetchObservations({
    now,
    features: {
      wikidata: {
        actors: [
          { imageFile: 'Free.jpg' },
          { imageFile: 'No licence.jpg' },
          { imageFile: 'Original.jpg' },
          { imageFile: 'No author.jpg' },
        ],
      },
    },
    fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get('iiurlwidth'), '120');
      return json({
        query: {
          pages: [
            portrait(
              'Free.jpg',
              'CC BY 4.0',
              thumb,
              '<a href="/wiki/User:Example">Example &amp; Co</a>',
            ),
            portrait(
              'No licence.jpg',
              'Copyrighted free use',
              thumb,
              'Example',
            ),
            portrait(
              'Original.jpg',
              'CC BY 4.0',
              thumb.replace('/thumb/', '/'),
              'Example',
            ),
            portrait('No author.jpg', 'CC BY 4.0', thumb, '<img src="/x">'),
          ],
        },
      });
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(data.portraits['Free.jpg'], {
    thumbnail: thumb,
    file: 'https://commons.wikimedia.org/wiki/File:Free.jpg',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    author: 'Example & Co',
  });
});

test('Bluesky normalizes authored posts, ignores reposts, and stops after a 429', async () => {
  const { fetchObservations, shouldCheck } = await import('./bluesky.js');
  const actors = [
    'alpha.example.org',
    'beta.example.org',
    'gamma.example.org',
  ].map((handle, i) => ({
    id: 'Q' + i,
    accounts: { bluesky: 'https://bsky.app/profile/' + handle },
  }));
  const post = {
    uri: 'at://did:plc:fixture/app.bsky.feed.post/key',
    author: { did: 'did:plc:fixture', handle: 'alpha.example.org' },
    record: { text: 'Fixture speech', createdAt: '2026-11-07T13:30:00Z' },
  };
  const calls = [];
  const result = await fetchObservations({
    now,
    features: { wikidata: { actors } },
    fetchImpl: async (url) => {
      const handle = new URL(url).searchParams.get('actor');
      calls.push(handle);
      if (calls.length === 2)
        return json({}, { status: 429, headers: { 'Retry-After': '90' } });
      return json({
        feed: [
          { post },
          {
            post: { ...post, author: { handle: 'other.example.org' } },
            reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
          },
        ],
      });
    },
  });
  assert.deepEqual(calls, ['alpha.example.org', 'beta.example.org']);
  assert.equal(result.count, 1);
  assert.match(result.error, /429/);
  assert.equal(shouldCheck({ now, data: result.data }), false);
  assert.deepEqual(result.data.feeds[actors[0].accounts.bluesky].posts, [
    {
      text: 'Fixture speech',
      url: 'https://bsky.app/profile/did:plc:fixture/post/key',
      publishedAt: '2026-11-07T13:30:00.000Z',
    },
  ]);
});

test('YouTube Atom and official RSS return linked headlines only', async () => {
  const youtube = await import('./youtube-rss.js');
  const government = await import('./government-rss.js');
  const channel = 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv';
  const yt = await youtube.fetchObservations({
    now,
    features: { wikidata: { actors: [{ accounts: { youtube: channel } }] } },
    fetchImpl: async (url) => {
      assert.match(url, /www\.youtube\.com\/feeds\/videos\.xml\?channel_id=UC/);
      return new Response(
        '<feed><entry><title>Fixture &amp; speech</title><link rel="alternate" href="https://www.youtube.com/watch?v=fixture"/><published>2026-11-07T13:30:00Z</published><content>Do not mirror</content></entry></feed>',
      );
    },
  });
  assert.equal(yt.count, 1);
  assert.equal(yt.data.feeds[channel].posts[0].text, 'Fixture & speech');
  const gov = await government.fetchObservations({
    now,
    fetchImpl: async (url) => {
      assert.equal(url, 'https://www.federalreserve.gov/feeds/press_all.xml');
      return new Response(
        '<rss><channel><item><title>Public bulletin</title><link>https://www.federalreserve.gov/newsevents/pressreleases/fixture.htm</link><description>Do not mirror</description></item></channel></rss>',
      );
    },
  });
  assert.equal(gov.count, 1);
  assert.equal(
    gov.data.feeds['https://www.federalreserve.gov/feeds/press_all.xml']
      .posts[0].text,
    'Public bulletin',
  );
});
