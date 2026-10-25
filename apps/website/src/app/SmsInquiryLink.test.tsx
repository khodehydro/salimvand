// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SmsInquiryLink } from './SmsInquiryLink';
import { ProductCard } from './ProductCard';
import { smsInquiryHref } from './sms-inquiry';

const name = 'پمپ بنزین پژو & پراید #۲ + فیلتر؟';
const message = `سلام\n\n${name} موجود هست؟\n\nقیمت چنده؟`;
const product = { slug: 'pump', name, code: 'P-2', availability: 'in_stock' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SMS inquiry URI', () => {
  it.each([
    ['tel:۰۹۱۲ ۱۲۳ ۴۵۶۷', '09121234567'],
    ['٠٩١٢١٢٣٤٥٦٧', '09121234567'],
    ['tel:+98 (912) 123-4567', '+989121234567'],
  ])('normalizes the configured contact number %s', (phone, expected) => {
    expect(smsInquiryHref(phone, name)).toBe(`sms:${expected}?body=${encodeURIComponent(message)}`);
  });

  it.each([false, true])('encodes Persian, punctuation and newlines with iOS=%s', (ios) => {
    const href = smsInquiryHref('tel:09121234567', name, ios)!;
    expect(href.startsWith(`sms:09121234567${ios ? '&' : '?'}body=`)).toBe(true);
    expect(decodeURIComponent(href.split('body=')[1])).toBe(message);
    expect(href).not.toContain('\n');
  });

  it.each([
    '',
    '#contact',
    'tel:',
    'javascript:1234567',
    'tel:09121234567,09129999999',
    'tel:09121234567?body=other',
    'tel:09121234567&body=other',
    'tel:++989121234567',
  ])('hides an invalid destination: %s', (phone) => {
    expect(smsInquiryHref(phone, name)).toBeNull();
  });
});

describe('SMS inquiry button', () => {
  it.each([
    ['Android', 'Linux armv8l', 5, '?'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5, '&'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5, '&'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5, '&'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 0, '?'],
  ])(
    'uses the device-compatible draft URL for %s (%s, touch=%s)',
    (userAgent, platform, maxTouchPoints, separator) => {
      vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
      render(<SmsInquiryLink phone="tel:09121234567" productName={name} />);
      const link = screen.getByRole('link', { name: `پیامک برای ${name}` });
      expect(link.getAttribute('href')).toBe(
        `sms:09121234567${separator}body=${encodeURIComponent(message)}`,
      );
      expect(link.getAttribute('target')).toBeNull();
    },
  );

  it('is server-renderable with a working default link and no navigator access', () => {
    vi.stubGlobal('navigator', undefined);
    const html = renderToStaticMarkup(
      <SmsInquiryLink phone="tel:09121234567" productName={name} />,
    );
    expect(html).toContain(`href="sms:09121234567?body=${encodeURIComponent(message)}"`);
  });

  it('adds a product-specific SMS action without changing call or messenger links', () => {
    render(
      <ProductCard
        product={product}
        contact={{
          tel: 'tel:09121234567',
          telegram: 'https://t.me/shop',
          bale: 'https://ble.ir/shop',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: `تماس برای ${name}` }).getAttribute('href')).toBe(
      'tel:09121234567',
    );
    expect(screen.getByRole('link', { name: `تلگرام برای ${name}` }).getAttribute('href')).toBe(
      'https://t.me/shop',
    );
    expect(screen.getByRole('link', { name: `بله برای ${name}` }).getAttribute('href')).toBe(
      'https://ble.ir/shop',
    );
    const sms = screen.getByRole('link', { name: `پیامک برای ${name}` });
    expect(decodeURIComponent(sms.getAttribute('href')!.split('body=')[1])).toBe(message);
    expect(sms.closest('.quick-row')?.querySelector('.quick-call')).not.toBeNull();
  });

  it('uses each card’s own product name, not another product’s draft', () => {
    render(
      <>
        <ProductCard product={product} contact={{ tel: 'tel:09121234567' }} />
        <ProductCard
          product={{ ...product, slug: 'filter', name: 'فیلتر روغن' }}
          contact={{ tel: 'tel:09121234567' }}
        />
      </>,
    );
    const second = screen.getByRole('link', { name: 'پیامک برای فیلتر روغن' });
    expect(decodeURIComponent(second.getAttribute('href')!.split('body=')[1])).toBe(
      'سلام\n\nفیلتر روغن موجود هست؟\n\nقیمت چنده؟',
    );
  });

  it('does not render a broken SMS action when no phone is configured', () => {
    render(
      <ProductCard
        product={product}
        contact={{ tel: '#contact', telegram: 'https://t.me/shop' }}
      />,
    );
    expect(screen.queryByRole('link', { name: `پیامک برای ${name}` })).toBeNull();
    expect(screen.getByRole('link', { name: `تلگرام برای ${name}` })).not.toBeNull();
  });
});
