'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { formatPersianNumber } from '@salimvand/shared';

export type CategoryItem = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
};

export function CategorySidebar({
  categories,
  currentCategoryId,
  currentCategoryName,
  productCount,
}: {
  categories: CategoryItem[];
  currentCategoryId: string;
  currentCategoryName: string;
  productCount?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((cat) => cat.name.toLowerCase().includes(query));
  }, [categories, search]);

  return (
    <>
      {/* Mobile Top Bar & Horizontal Quick Chips */}
      <div className="category-mobile-section">
        <div className="category-mobile-bar">
          <div className="category-mobile-info">
            <span className="category-mobile-label">دسته‌بندی فعلی:</span>
            <strong className="category-mobile-current">{currentCategoryName}</strong>
            {productCount !== undefined && (
              <span className="category-count-badge">{formatPersianNumber(productCount)} قطعه</span>
            )}
          </div>
          <button
            type="button"
            className="category-mobile-trigger"
            onClick={() => setIsOpen(true)}
            aria-label="باز کردن منوی دسته‌بندی‌ها"
            aria-expanded={isOpen}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            <span>دسته‌بندی‌ها</span>
            <span className="category-badge-chip">{formatPersianNumber(categories.length)}</span>
          </button>
        </div>

        {/* Quick horizontal scrolling chips for 1-tap switching */}
        {categories.length > 1 && (
          <nav className="category-mobile-chips" aria-label="دسته‌بندی‌های سریع">
            {categories.map((item) => {
              const isActive = item.id === currentCategoryId;
              return (
                <a
                  key={item.id}
                  href={`/category/${encodeURIComponent(item.slug)}`}
                  className={`category-chip ${isActive ? 'is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.name}
                </a>
              );
            })}
          </nav>
        )}
      </div>

      {/* Desktop Sticky Sidebar (اسلاید بار کناری دسکتاپ) */}
      <aside className="category-sidebar" aria-label="دسته‌بندی قطعات">
        <div className="category-sidebar-header">
          <div className="category-sidebar-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>دسته‌بندی‌ها</span>
          </div>
          <span className="category-count-pill" title="تعداد کل دسته‌بندی‌ها">
            {formatPersianNumber(categories.length)}
          </span>
        </div>

        {categories.length > 6 && (
          <div className="category-sidebar-search">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجوی دسته..."
              aria-label="جست‌وجوی دسته‌بندی"
            />
            {search && (
              <button
                type="button"
                className="category-search-clear"
                onClick={() => setSearch('')}
                aria-label="پاک کردن جست‌وجو"
              >
                ✕
              </button>
            )}
          </div>
        )}

        <nav className="category-nav-list" aria-label="لیست دسته‌بندی‌ها">
          {filteredCategories.length > 0 ? (
            filteredCategories.map((item) => {
              const isActive = item.id === currentCategoryId;
              return (
                <a
                  key={item.id}
                  href={`/category/${encodeURIComponent(item.slug)}`}
                  className={`category-nav-link ${isActive ? 'is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="category-nav-name">{item.name}</span>
                  {isActive && (
                    <span className="category-active-dot" aria-label="انتخاب شده">
                      ●
                    </span>
                  )}
                </a>
              );
            })
          ) : (
            <div className="category-no-match">دسته‌ای با این نام پیدا نشد.</div>
          )}
        </nav>

        <a href="/#catalog" className="category-sidebar-all">
          <span>همهٔ قطعات فروشگاه</span>
          <span aria-hidden="true">←</span>
        </a>
      </aside>

      {/* Mobile Slide Drawer & Backdrop (اسلاید بار کشویی موبایل) */}
      <div
        className={`category-drawer-backdrop ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`category-drawer ${isOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal={isOpen}
        aria-label="دسته‌بندی‌های محصولات"
      >
        <div className="category-drawer-header">
          <div className="category-drawer-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <strong>دسته‌بندی قطعات</strong>
            <span className="category-count-pill">{formatPersianNumber(categories.length)}</span>
          </div>
          <button
            type="button"
            className="category-drawer-close"
            onClick={() => setIsOpen(false)}
            aria-label="بستن منو"
          >
            ✕
          </button>
        </div>

        <div className="category-drawer-search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جست‌وجوی دسته..."
            aria-label="جست‌وجوی دسته‌بندی"
          />
          {search && (
            <button
              type="button"
              className="category-search-clear"
              onClick={() => setSearch('')}
              aria-label="پاک کردن جست‌وجو"
            >
              ✕
            </button>
          )}
        </div>

        <nav className="category-drawer-list" aria-label="لیست دسته‌بندی‌ها">
          {filteredCategories.length > 0 ? (
            filteredCategories.map((item) => {
              const isActive = item.id === currentCategoryId;
              return (
                <a
                  key={item.id}
                  href={`/category/${encodeURIComponent(item.slug)}`}
                  className={`category-nav-link ${isActive ? 'is-active' : ''}`}
                  onClick={() => setIsOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="category-nav-name">{item.name}</span>
                  {isActive && (
                    <span className="category-active-dot" aria-label="انتخاب شده">
                      ●
                    </span>
                  )}
                </a>
              );
            })
          ) : (
            <div className="category-no-match">دسته‌ای با این نام پیدا نشد.</div>
          )}
        </nav>

        <a
          href="/#catalog"
          className="category-sidebar-all drawer-footer-link"
          onClick={() => setIsOpen(false)}
        >
          <span>مشاهدهٔ همهٔ قطعات</span>
          <span aria-hidden="true">←</span>
        </a>
      </div>
    </>
  );
}
