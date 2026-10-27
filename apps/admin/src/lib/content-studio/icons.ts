/** Local vector icons: crisp at every export size; no icon-font or remote requests. */
export type StudioIcon = 'telegram' | 'bale' | 'website' | 'phone' | 'inquiry' | 'address';
const paths: Record<StudioIcon, string[]> = {
  telegram: ['M21 3 3 10l7 3 3 7 8-17Z', 'm10 13 6-6'],
  bale: ['M20 11a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 11Z', 'm8 10 3 3 5-6'],
  website: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  phone: ['M5 3h4l2 5-3 2c1 3 3 5 6 6l2-3 5 2v4c0 2-3 3-5 2C9 19 5 15 3 8 2 6 3 3 5 3Z'],
  inquiry: [
    'M21 11a8 8 0 0 1-8 8H4l1-4A8 8 0 1 1 21 11Z',
    'M10 8a2 2 0 0 1 4 0c0 2-2 2-2 4M12 15h.01',
  ],
  address: [
    'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z',
    'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
};
export function drawStudioIcon(
  c: CanvasRenderingContext2D,
  kind: StudioIcon,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  c.save();
  c.translate(x, y);
  c.scale(size / 24, size / 24);
  c.strokeStyle = color;
  c.lineWidth = 1.8;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const path of paths[kind]) c.stroke(new Path2D(path));
  c.restore();
}
export function studioPersianDigits(value: string) {
  return value.replace(
    /[0-9٠-٩]/g,
    (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit.charCodeAt(0) - (digit <= '9' ? 48 : 1632)],
  );
}
