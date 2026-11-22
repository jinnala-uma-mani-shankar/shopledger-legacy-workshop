'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const coupons = require('../lib/coupons');
const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');

function makeStoredOrder({ id = 7, item, coupon = '', totals = {} }) {
  return {
    id,
    date: '22/11/2026',
    customer: 'In-memory characterization customer',
    customerId: null,
    paymentMode: 'cash',
    status: 'completed',
    items: [item],
    coupon,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total,
  };
}

test('order pricing applies the HSN rate after the capped coupon discount', () => {
  const items = [{ id: 1, sku: 'RICE-1', name: 'Rice', hsn: '1006', price: 4000, qty: 1 }];
  const totals = pricing.computeTotals(items, 'WHOLESALE15');

  assert.deepEqual(
    { subtotal: totals.subtotal, discount: totals.discount, tax: totals.tax, cgst: totals.cgst, sgst: totals.sgst, total: totals.total },
    { subtotal: 4000, discount: 400, tax: 180, cgst: 90, sgst: 90, total: 3780 },
  );
});

test('invoice matches the billed order total and GST breakdown', () => {
  const item = { id: 4, sku: 'RICE-3', name: 'Rice', hsn: '1006', price: 1000, qty: 1 };
  const billed = pricing.computeTotals([item], 'SAVE10');
  const order = makeStoredOrder({ item, coupon: 'SAVE10', totals: billed });
  const figures = invoice.computeInvoiceFigures(order);

  assert.deepEqual(
    { subtotal: figures.subtotal, discount: figures.discount, tax: figures.tax, cgst: figures.cgst, sgst: figures.sgst, total: figures.total },
    { subtotal: billed.subtotal, discount: billed.discount, tax: billed.tax, cgst: billed.cgst, sgst: billed.sgst, total: billed.total },
  );
  assert.deepEqual(
    { gstPercent: figures.rows[0].gstPercent, lineTax: figures.rows[0].lineTax },
    { gstPercent: billed.lines[0].gstPercent, lineTax: billed.lines[0].tax },
  );
});

test('invoice keeps a saved coupon cap and HSN line tax', () => {
  const item = { id: 1, sku: 'RICE-1', name: 'Rice', hsn: '1006', price: 4000, qty: 1 };
  const billed = pricing.computeTotals([item], 'WHOLESALE15');
  const figures = invoice.computeInvoiceFigures(makeStoredOrder({ item, coupon: 'WHOLESALE15', totals: billed }));

  assert.deepEqual(
    { discount: figures.discount, tax: figures.tax, total: figures.total },
    { discount: 400, tax: 180, total: 3780 },
  );
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 180);
});

test('invoice honors saved totals when the coupon has since expired', () => {
  const item = { id: 2, sku: 'DAL-1', name: 'Dal', hsn: '0713', price: 1500, qty: 1 };
  const savedTotals = { subtotal: 1500, discount: 250, tax: 62.5, total: 1312.5 };
  const order = makeStoredOrder({ item, coupon: 'DIWALI20', totals: savedTotals });
  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(coupons.validate('DIWALI20', 1500).valid, false);
  assert.deepEqual(
    { subtotal: figures.subtotal, discount: figures.discount, tax: figures.tax, cgst: figures.cgst, sgst: figures.sgst, total: figures.total },
    { subtotal: 1500, discount: 250, tax: 62.5, cgst: 31.25, sgst: 31.25, total: 1312.5 },
  );
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 62.5);
});

test('rendered invoice shows billed figures and no mismatch warning', () => {
  const item = { id: 3, sku: 'RICE-2', name: 'Rice', hsn: '1006', price: 1000, qty: 1 };
  const billed = pricing.computeTotals([item], 'SAVE10');
  const order = makeStoredOrder({ item, coupon: 'SAVE10', totals: billed });
  const html = invoice.render(order);

  assert.match(html, /5%/);
  assert.match(html, /₹45\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹945\.00/);
  assert.doesNotMatch(html, /differs from Order Ledger recorded total/);
});
