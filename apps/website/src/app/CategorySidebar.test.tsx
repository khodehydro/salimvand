import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CategorySidebar } from './CategorySidebar';

describe('CategorySidebar', () => {
  const categories = [
    { id: 'cat-1', name: 'لوازم ترمز', slug: 'lozazem-tormoz' },
    { id: 'cat-2', name: 'قاب ستون', slug: 'gbs-1788110183462' },
    { id: 'cat-3', name: 'فیلترها', slug: 'filterha' },
  ];

  it('renders the sidebar and drawer with all categories', () => {
    const html = renderToStaticMarkup(
      <CategorySidebar
        categories={categories}
        currentCategoryId="cat-2"
        currentCategoryName="قاب ستون"
        productCount={5}
      />,
    );

    // Desktop sidebar exists
    expect(html).toContain('class="category-sidebar"');
    expect(html).toContain('دسته‌بندی‌ها');

    // Current category is marked active
    expect(html).toContain('is-active');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('قاب ستون');

    // Mobile bar and quick chips exist
    expect(html).toContain('class="category-mobile-bar"');
    expect(html).toContain('class="category-mobile-trigger"');
    expect(html).toContain('class="category-mobile-chips"');

    // Mobile off-canvas slide drawer exists
    expect(html).toContain('class="category-drawer-backdrop "');
    expect(html).toContain('class="category-drawer "');
    expect(html).toContain('دسته‌بندی قطعات');
  });

  it('links each category to its url', () => {
    const html = renderToStaticMarkup(
      <CategorySidebar
        categories={categories}
        currentCategoryId="cat-1"
        currentCategoryName="لوازم ترمز"
        productCount={2}
      />,
    );

    expect(html).toContain('/category/lozazem-tormoz');
    expect(html).toContain('/category/gbs-1788110183462');
    expect(html).toContain('/category/filterha');
  });
});
