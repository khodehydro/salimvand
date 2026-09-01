import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type Trend = { date: string; revenue: string; paid: string; invoiceCount: number };
export type InventoryTrend = { date: string; inbound: number; outbound: number; returns: number };
export type ProfitTrend = { date: string; revenue: string; cost: string; profit: string };
const money = (value: number | string) =>
  `${new Intl.NumberFormat('fa-IR').format(Number(value))} ریال`;

export function SalesChart({ data }: { data: Trend[] }) {
  const chartData = data.map((row, index) => ({
    ...row,
    revenueNumber: Number(row.revenue),
    paidNumber: Number(row.paid),
    label: new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(
      new Date(`${row.date}T12:00:00`),
    ),
    isToday: index === data.length - 1,
    averageNumber: 0,
  }));
  const average =
    chartData.reduce((sum, row) => sum + row.revenueNumber, 0) / (chartData.length || 1);
  for (const row of chartData) row.averageNumber = Math.round(average);
  return (
    <div className="dashboard-chart">
      <div className="chart-legend">
        <span>
          <i className="legend-revenue" /> فروش (میلیون ریال)
        </span>
        <span>
          <i className="legend-avg" /> میانگین
        </span>
      </div>
      {chartData.length ? (
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid
              stroke="var(--sv-border)"
              strokeDasharray="3 3"
              horizontal
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--sv-text-2)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--sv-text-2)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}م`}
              width={38}
            />
            <Tooltip
              formatter={(value, name) => [
                money(Number(value)),
                name === 'revenueNumber' ? 'فروش' : 'میانگین دوره',
              ]}
              labelFormatter={(label) => `تاریخ: ${label}`}
              contentStyle={{
                direction: 'rtl',
                background: 'var(--sv-surface)',
                border: '1px solid var(--sv-border)',
                borderRadius: 8,
                color: 'var(--sv-text)',
              }}
            />
            {/* Bar per day like the design mock; the last (today) bar is
                highlighted with a lighter fill. */}
            <Bar dataKey="revenueNumber" name="revenueNumber" radius={[5, 5, 2, 2]} maxBarSize={26}>
              {chartData.map((row, index) => (
                <Cell key={index} fill={row.isToday ? 'var(--sv-brand-300)' : 'var(--sv-link)'} />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="averageNumber"
              name="averageNumber"
              stroke="var(--sv-border-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <p className="muted chart-empty">در این بازه فروش ثبت نشده است.</p>
      )}
    </div>
  );
}
export function InventoryChart({ data }: { data: InventoryTrend[] }) {
  const chartData = data.map((row) => ({
    ...row,
    label: new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(
      new Date(`${row.date}T12:00:00`),
    ),
  }));
  const lines = [
    { key: 'inbound', label: 'ورود', color: 'var(--sv-link)' },
    { key: 'outbound', label: 'خروج', color: 'var(--sv-danger)' },
    { key: 'returns', label: 'مرجوعی', color: 'var(--sv-warn)' },
  ];
  return (
    <div className="dashboard-chart">
      <div className="chart-legend">
        {lines.map((line) => (
          <span key={line.key}>
            <i style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
      {chartData.length ? (
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={chartData} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid
              stroke="var(--sv-border)"
              strokeDasharray="3 3"
              horizontal
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--sv-text-2)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--sv-text-2)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              labelFormatter={(label) => `تاریخ: ${label}`}
              formatter={(value, name) => [
                Number(value),
                lines.find((line) => line.key === name)?.label ?? name,
              ]}
              contentStyle={{
                direction: 'rtl',
                background: 'var(--sv-surface)',
                border: '1px solid var(--sv-border)',
                borderRadius: 8,
                color: 'var(--sv-text)',
              }}
            />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                strokeWidth={2}
                dot={{ r: 3, fill: line.color, strokeWidth: 2, stroke: 'var(--sv-surface)' }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="muted chart-empty">در این بازه تراکنشی ثبت نشده است.</p>
      )}
    </div>
  );
}
export function ProfitChart({ data }: { data: ProfitTrend[] }) {
  const chartData = data.map((row) => ({
    ...row,
    revenueNumber: Number(row.revenue),
    costNumber: Number(row.cost),
    profitNumber: Number(row.profit),
    label: new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' }).format(
      new Date(`${row.date}T12:00:00`),
    ),
  }));
  const lines = [
    { key: 'revenueNumber', label: 'فروش', color: 'var(--sv-link)' },
    { key: 'costNumber', label: 'هزینه', color: 'var(--sv-danger)' },
    { key: 'profitNumber', label: 'سود', color: 'var(--sv-ok)' },
  ];
  return (
    <div className="dashboard-chart">
      <div className="chart-legend">
        {lines.map((line) => (
          <span key={line.key}>
            <i style={{ background: line.color }} />
            {line.label}
          </span>
        ))}
      </div>
      {chartData.length ? (
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={chartData} margin={{ top: 12, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid
              stroke="var(--sv-border)"
              strokeDasharray="3 3"
              horizontal
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--sv-text-2)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--sv-text-2)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={38}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}م`}
            />
            <Tooltip
              labelFormatter={(label) => `تاریخ: ${label}`}
              formatter={(value, name) => [
                money(Number(value)),
                lines.find((line) => line.key === name)?.label ?? name,
              ]}
              contentStyle={{
                direction: 'rtl',
                background: 'var(--sv-surface)',
                border: '1px solid var(--sv-border)',
                borderRadius: 8,
                color: 'var(--sv-text)',
              }}
            />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                strokeWidth={2}
                dot={{ r: 3, fill: line.color, strokeWidth: 2, stroke: 'var(--sv-surface)' }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="muted chart-empty">در این بازه سودی ثبت نشده است.</p>
      )}
    </div>
  );
}
