// test/email-render.test.mjs — what a campaign email looks like to real mail clients, checked on internal fixtures:
// the builder's HTML stays table-based with inline styles (Outlook, Gmail, Apple Mail strip <style> and ignore flex
// and grid), carries the preheader, the unsubscribe token, image alt text and a 600px wrap that stacks on phones;
// the server's render fills tokens and fallbacks, escapes values, appends the footer and produces a text part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compile, newBlock, emptyDesign, STARTERS, normalizeDesign } from '../src/lib/newsletter.js';
const require = createRequire(import.meta.url);
const campaigns = require('../lib/server/campaigns.cjs');

const fixture = () => ({ ...emptyDesign(), blocks: [
  newBlock('image', { src: 'https://cdn.test/hero.png', alt: 'Stage at the gala' }),
  newBlock('heading', { text: 'See you at {{event}}, {{first_name|there}}' }),
  newBlock('text', { html: '<p>Hello {{first_name|friend}} from {{company}} &amp; co.</p>' }),
  newBlock('columns', {}),
  newBlock('button', { text: 'RSVP', href: 'https://fatfish.test/rsvp?a=1&b=2' }),
  newBlock('footer', {}),
] });

test('the compiled newsletter is client-safe: tables and inline styles only, fixed width that stacks on phones, preheader, alt text, unsubscribe token', () => {
  const html = compile(fixture(), { preheader: 'Save the date', title: 'Gala' });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(!/display\s*:\s*(flex|grid)/i.test(html), 'no flex or grid');
  assert.ok(!/<(section|article|nav|main)\b/i.test(html), 'no HTML5 sectioning elements');
  assert.match(html, /<table[^>]*class="ff-wrap"[^>]*width="600"/, 'a 600px table wrap');
  assert.match(html, /\.ff-col \{ display:block !important/, 'columns stack on phones');
  assert.match(html, /mso-hide:all;">Save the date/, 'hidden preheader');
  assert.match(html, /<img[^>]*alt="Stage at the gala"/, 'alt text kept');
  assert.match(html, /href="\{\{unsubscribe_url\}\}"/, 'footer carries the unsubscribe token');
  assert.match(html, /href="https:\/\/fatfish\.test\/rsvp\?a=1&amp;b=2"/, 'attribute-escaped button link');
  // every <p> and <a> the compiler writes carries inline styles (mail clients drop stylesheets)
  for (const tag of html.match(/<(p|a) [^>]*>/g) || []) assert.match(tag, /style="/, tag);
});

test('the server render for one recipient fills tokens and fallbacks, escapes values, keeps the unsubscribe link and makes a text part', () => {
  const html = compile(fixture(), { preheader: '', title: 'Gala' });
  const email = { id: 'e1', campaign_id: 'cp1', name: 'Invitation', campaign_name: 'Gala 2027', from_name: 'Isaac Gonzalez', postal_address: '123 Main St, Salt Lake City' };
  const ctx = campaigns.contextFor({ name: 'Ada Lovelace', companies: { name: 'Acme & Sons' }, unsub_token: '11111111-1111-4111-8111-111111111111' }, email, 'https://ff.test');
  const body = campaigns.render(campaigns.ensureFooter(html, { html: true, postalAddress: email.postal_address }), ctx, true);
  assert.match(body, /See you at Gala 2027, Ada/);
  assert.match(body, /Hello Ada from Acme &amp; Sons &amp; co\./, 'values are escaped, existing entities untouched');
  assert.match(body, /href="https:\/\/ff\.test\/u\/11111111-1111-4111-8111-111111111111\?c=cp1&e=e1"/);
  assert.match(body, /123 Main St, Salt Lake City/, 'postal address appended when the design has none');
  assert.ok(!/\{\{/.test(body), 'no token left unrendered');
  const anon = campaigns.render(campaigns.ensureFooter(html, { html: true }), campaigns.contextFor({ name: '', companies: null, unsub_token: 'test' }, email, 'https://ff.test'), true);
  assert.match(anon, /See you at Gala 2027, there/); assert.match(anon, /Hello friend from/); assert.match(anon, /\/u\/test"/, 'the test link for previews');
  const text = campaigns.textFromHtml(body);
  assert.match(text, /See you at Gala 2027, Ada/); assert.match(text, /RSVP \(https:\/\/fatfish\.test\/rsvp\?a=1&b=2\)/); assert.match(text, /Unsubscribe/);
  assert.ok(!/<[a-z]/i.test(text), 'the text part has no tags');
});

test('every starter layout compiles to client-safe HTML and a legacy design is repaired before compiling', () => {
  for (const s of STARTERS) { const html = compile({ ...emptyDesign(), blocks: s.make() }); assert.match(html, /<\/html>\s*$/); assert.ok(!/display\s*:\s*flex/i.test(html), s.id); }
  const repaired = normalizeDesign({ blocks: [{ type: 'columns', cells: [{ heading: 'only one' }] }, { type: 'bogus' }] });
  assert.equal(repaired.blocks.length, 1); assert.equal(repaired.blocks[0].cells.length, 2);
});

test('a plain-text email gets a text footer and keeps line breaks', () => {
  const body = campaigns.ensureFooter('Hi {{first_name|there}},\n\nSee you soon.', { html: false, postalAddress: '1 Elm St' });
  const out = campaigns.render(body, { first_name: '', unsubscribe_url: 'https://ff.test/u/x' }, false);
  assert.equal(out, 'Hi there,\n\nSee you soon.\n\nUnsubscribe: https://ff.test/u/x\n1 Elm St');
});
