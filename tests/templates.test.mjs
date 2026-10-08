import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTemplateId, templateInfo, FREE_TEMPLATE_IDS, PAID_TEMPLATE_IDS, templatePrice } from '../config/templates.js';

/** Resume Builder templates: which are free, which must be bought, and the price. */

test('three free templates, six paid', () => {
  assert.deepEqual(FREE_TEMPLATE_IDS, ['dl-elite', 'ats-minimal', 'ats-fresher']);
  assert.equal(PAID_TEMPLATE_IDS.length, 6);
  assert.ok(PAID_TEMPLATE_IDS.includes('dl-modern'));
});

test('old "ats-…" ids map to the same template', () => {
  assert.equal(canonicalTemplateId('ats-classic'), 'dl-elite');
  assert.equal(canonicalTemplateId('ats-modern'), 'dl-modern');
  assert.equal(templateInfo('ats-international').id, 'dl-creative');
  assert.equal(templateInfo('ats-classic').free, true);
});

test('unknown template ids are rejected', () => {
  assert.equal(canonicalTemplateId('anything-else'), null);
  assert.equal(templateInfo(''), null);
});

test('price defaults to 199 and follows TEMPLATE_PRICE', () => {
  delete process.env.TEMPLATE_PRICE;
  assert.equal(templatePrice(), 199);
  process.env.TEMPLATE_PRICE = '249';
  assert.equal(templatePrice(), 249);
  process.env.TEMPLATE_PRICE = 'abc';
  assert.equal(templatePrice(), 199, 'bad value falls back');
  delete process.env.TEMPLATE_PRICE;
});
