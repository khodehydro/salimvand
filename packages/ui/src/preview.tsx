import {
  AvailabilityBadge,
  Badge,
  BrandChip,
  Button,
  Card,
  Checkbox,
  Code,
  DataTable,
  DonutChart,
  EmptyState,
  Field,
  Input,
  KpiCard,
  Num,
  SearchInput,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  StockBar,
  Switch,
  Tabs,
  ThemeProvider,
  ThemeToggle,
  Timeline,
  TrendBarChart,
} from './components';
import { brand, lightTokens, darkTokens, spacing, geometry, type SemanticTokens, type Theme } from './tokens';

/** Token sample required by the delivery spec phase 0 acceptance criteria. */
export function TokenGallery() {
  const swatches = (tokens: SemanticTokens, caption: string) => (
    <Card title={caption}>
      <div className="sv-empty" style={{ justifyItems: 'start' }}>
        {Object.entries(brand).map(([step, value]) => (
          <span key={step}>
            <Code value={`brand-${step} ${value}`} />
          </span>
        ))}
        {Object.entries(tokens).map(([key, value]) => (
          <span key={key}>
            <Code value={`${key} ${value}`} />
          </span>
        ))}
        <span>
          <Code value={`radius ${geometry.radiusButton}/${geometry.radiusCard}/${geometry.radiusPill}`} />
        </span>
        <span>
          <Code value={`spacing ${spacing.join('/')}`} />
        </span>
      </div>
    </Card>
  );

  const rows = [
    { name: 'لنت ترمز جلو پژو ۲۰۶', brand: 'ایساکو', quantity: 12, min: 5, status: 'in_stock', code: 'BRK-00452' },
    { name: 'کمک فنر عقب پژو پارس', brand: 'مونرو', quantity: 2, min: 4, status: 'low_stock', code: 'SUS-00290' },
    { name: 'رادیاتور آب پژو ۲۰۶', brand: 'کوشش', quantity: 0, min: 2, status: 'out_of_stock', code: 'CLG-00072' },
  ];

  return (
    <div className="sv-preview" style={{ display: 'grid', gap: 16 }}>
      <Card title="توکن‌ها — پوستهٔ روشن">{swatches(lightTokens, 'light')}</Card>
      <Card title="توکن‌ها — پوستهٔ تاریک">{swatches(darkTokens, 'dark')}</Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary">دکمهٔ اصلی</Button>
        <Button variant="outline">outline</Button>
        <Button variant="soft">soft</Button>
        <Button variant="ghost">ghost</Button>
        <Button variant="danger">danger</Button>
        <Button size="sm">کوچک</Button>
        <Button size="lg">بزرگ</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="ok">موجود</Badge>
        <Badge tone="warn">کم</Badge>
        <Badge tone="danger">ناموجود</Badge>
        <Badge tone="neutral">توقف</Badge>
        <AvailabilityBadge availability="in_stock" />
        <AvailabilityBadge availability="coming_soon" />
        <BrandChip name="ایساکو" inStock />
        <BrandChip name="مهر" inStock={false} />
        <Num value={12480} />
        <Code value="9653514180" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <KpiCard label="فروش امروز" value={<Num value={48620} />} delta="۱۸٪ نسبت به دیروز" tone="ok" />
        <KpiCard label="هشدار کمبود" value={<Num value={7} />} hint="۲ قلم بیشتر از دیروز" tone="warn" />
      </div>
      <Card title="جدول اقلام">
        <DataTable
          rows={rows}
          rowKey={(row) => row.code}
          columns={[
            { key: 'name', header: 'کالا' },
            { key: 'brand', header: 'برند' },
            { key: 'quantity', header: 'موجودی', render: (row) => <StockBar value={row.quantity} min={row.min} /> },
            { key: 'status', header: 'وضعیت', render: (row) => <AvailabilityBadge availability={row.status} /> },
            { key: 'code', header: 'کد', render: (row) => <Code value={row.code} /> },
          ]}
        />
      </Card>
      <Card title="فرم‌ها">
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="نام قطعه" required hint="فارسی یا لاتین">
            <Input placeholder="لنت ترمز" />
          </Field>
          <Field label="دسته‌بندی">
            <Select>
              <option>ترمز</option>
              <option>فیلتراسیون</option>
            </Select>
          </Field>
          <SearchInput value="" onValueChange={() => undefined} placeholder="جست‌وجوی قطعه یا بارکد" hotkey="Ctrl K" />
          <div style={{ display: 'flex', gap: 16 }}>
            <Checkbox label="فقط موجود" checked onChange={() => undefined} />
            <Switch label="اعلان تلگرام" checked onChange={() => undefined} />
            <Segmented
              options={[
                { value: 'today', label: 'امروز' },
                { value: 'week', label: '۷ روز' },
                { value: 'month', label: '۳۰ روز' },
              ]}
              value="today"
              onChange={() => undefined}
            />
          </div>
          <Tabs
            tabs={[
              { id: 'base', label: 'اطلاعات پایه' },
              { id: 'images', label: 'تصاویر' },
              { id: 'items', label: 'اقلام برند', badge: 3 },
            ]}
            active="base"
            onChange={() => undefined}
          />
        </div>
      </Card>
      <Card title="نمودارها">
        <DonutChart
          data={[
            { name: 'ترمز و جلوبندی', value: 3120 },
            { name: 'فیلتراسیون', value: 2480 },
            { name: 'موتور و انتقال', value: 2260 },
          ]}
        />
        <TrendBarChart data={[{ label: '۱', value: 12 }, { label: '۲', value: 18 }, { label: '۳', value: 9 }]} />
      </Card>
      <Card title="تایم‌لاین دفتر تراکنش‌ها">
        <Timeline
          items={[
            { id: '1', title: 'فروش ۲ عدد', subtitle: 'لنت ۲۰۶ · ایساکو', meta: '۱۴:۲۲', tone: 'danger' },
            { id: '2', title: 'ورود کالا ۲۰ عدد', subtitle: 'فاکتور خرید ۱۴۰۵-۰۰۳۱', meta: '۱۱:۰۵', tone: 'ok' },
          ]}
        />
      </Card>
      <Card title="حالت‌های خالی و بارگذاری">
        <Skeleton lines={3} />
        <EmptyState title="فاکتوری یافت نشد" description="بازهٔ تاریخ را تغییر دهید." />
      </Card>
      <Sheet open title="نمونهٔ شیت" onClose={() => undefined} footer={<Button>ثبت</Button>}>
        <p>کشوی کناری از لبهٔ inline-end باز می‌شود.</p>
      </Sheet>
    </div>
  );
}

/** Phase 0 acceptance: the same gallery renders in both skins. */
export function DesignSystemPreview({ theme = 'light' }: { theme?: Theme }) {
  return (
    <ThemeProvider theme={theme}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>سیستم طراحی سلیم‌وند</strong>
        <ThemeToggle />
      </header>
      <TokenGallery />
    </ThemeProvider>
  );
}
