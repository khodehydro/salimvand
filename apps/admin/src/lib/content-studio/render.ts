import { drawStudioIcon, studioPersianDigits, type StudioIcon } from './icons';
import {
  STUDIO_FORMATS,
  formatGroupedPersian,
  formatPersianNumber,
  studioPrice,
  type StudioFormat,
  type StudioFrame,
  type StudioProduct,
  type StudioSettings,
  type StudioSnapshot,
} from '@salimvand/shared';

const NAVY = '#0b2036',
  INK = '#102e4c',
  MUTED = '#61758b';
const ACCENTS = { green: '#2bb68b', gold: '#cf9b59', blue: '#529ee3' };
export function checkStudioAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('عملیات لغو شد', 'AbortError');
}
export class StudioRenderer {
  private cache = new Map<string, HTMLImageElement | null>();
  readonly warnings = new Set<string>();
  private fonts?: Promise<unknown>;
  private crops = new WeakMap<HTMLImageElement, { x: number; y: number; w: number; h: number }>();
  constructor(private readonly signal?: AbortSignal) {}
  dispose() {
    for (const image of this.cache.values()) if (image) image.src = '';
    this.cache.clear();
  }
  private async image(path: string): Promise<HTMLImageElement | null> {
    checkStudioAbort(this.signal);
    if (!/^\/uploads\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) return null;
    if (this.cache.has(path)) return this.cache.get(path)!;
    const image = await new Promise<HTMLImageElement | null>((resolve, reject) => {
      const img = new Image();
      const finish = (value: HTMLImageElement | null) => {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', abort);
        img.onload = null;
        img.onerror = null;
        if (!value) img.src = '';
        resolve(value);
      };
      const abort = () => {
        finish(null);
        reject(new DOMException('عملیات لغو شد', 'AbortError'));
      };
      const timer = setTimeout(() => finish(null), 12000);
      img.onload = () => finish(img.naturalWidth ? img : null);
      img.onerror = () => finish(null);
      this.signal?.addEventListener('abort', abort, { once: true });
      img.src = path;
    });
    checkStudioAbort(this.signal);
    if (this.cache.size >= 16) {
      const key = this.cache.keys().next().value!;
      const previous = this.cache.get(key);
      if (previous) previous.src = '';
      this.cache.delete(key);
    }
    this.cache.set(path, image);
    return image;
  }
  async render(
    frame: StudioFrame,
    format: StudioFormat,
    snapshot: StudioSnapshot,
    settings: StudioSettings,
    variants: Record<string, string> = {},
    strict = false,
  ): Promise<HTMLCanvasElement> {
    checkStudioAbort(this.signal);
    this.fonts ??= Promise.all([
      document.fonts.load('400 32px Vazirmatn'),
      document.fonts.load('700 32px Vazirmatn'),
    ]);
    await this.fonts;
    checkStudioAbort(this.signal);
    const { width: W, height: H } = STUDIO_FORMATS[format];
    const tall = format === 'story',
      dark = frame.kind === 'cover',
      accent = ACCENTS[settings.accent];
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('مرورگر از ساخت تصویر پشتیبانی نمی‌کند');
    const box = (x: number, y: number, w: number, h: number, fill: string, r = 20) => {
      c.fillStyle = fill;
      c.beginPath();
      c.roundRect(x, y, w, h, r);
      c.fill();
    };
    const font = (size: number, weight = 400) => {
      c.font = `${weight} ${size}px Vazirmatn`;
    };
    const line = (
      value: string,
      x: number,
      y: number,
      max: number,
      size: number,
      color: string,
      weight = 400,
      align: CanvasTextAlign = 'right',
      min = size,
    ) => {
      c.fillStyle = color;
      c.textAlign = align;
      c.direction = align === 'left' ? 'ltr' : 'rtl';
      font(size, weight);
      while (size > min && c.measureText(value).width > max) font(--size, weight);
      if (c.measureText(value).width > max) {
        let chars = Array.from(value);
        while (chars.length && c.measureText(chars.join('') + '…').width > max) chars.pop();
        value = chars.join('') + '…';
      }
      c.fillText(value, x, y);
    };
    const wrap = (
      value: string,
      x: number,
      y: number,
      max: number,
      size: number,
      color: string,
      weight = 400,
      limit = 2,
      align: CanvasTextAlign = 'right',
    ) => {
      font(size, weight);
      const words = value.trim().split(/\s+/);
      const rows: string[] = [];
      let row = '';
      for (const word of words) {
        if (row && c.measureText(row + ' ' + word).width > max) {
          rows.push(row);
          row = word;
        } else row += (row ? ' ' : '') + word;
      }
      if (row) rows.push(row);
      rows
        .slice(0, limit)
        .forEach((text, i) =>
          line(
            i === limit - 1 && rows.length > limit ? text + ' …' : text,
            x,
            y + i * size * 1.35,
            max,
            size,
            color,
            weight,
            align,
          ),
        );
      return Math.min(rows.length, limit) * size * 1.35;
    };
    const contactLine = (
      kind: StudioIcon,
      value: string,
      y: number,
      size: number,
      color: string,
      weight = 400,
      center = W / 2,
      max = 912,
    ) => {
      font(size, weight);
      const width = Math.min(c.measureText(value).width, max);
      const left = center - (width + 38) / 2;
      drawStudioIcon(c, kind, left, y - size + 2, 26, color);
      line(value, left + 38, y, max, size, color, weight, 'left', Math.min(size, 20));
    };
    const priceLine: typeof line = (
      value,
      x,
      y,
      max,
      size,
      color,
      weight = 700,
      align = 'right',
      min = size,
    ) => {
      if (value === 'استعلام قیمت') {
        const iconSize = Math.min(28, size);
        drawStudioIcon(c, 'inquiry', x - iconSize, y - iconSize + 3, iconSize, color);
        line(value, x - iconSize - 10, y, max - iconSize - 10, size, color, weight, align, min);
      } else line(value, x, y, max, size, color, weight, align, min);
    };
    const contain = (
      image: HTMLImageElement,
      x: number,
      y: number,
      w: number,
      h: number,
      trim = false,
    ) => {
      let crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
      if (trim) {
        const cached = this.crops.get(image);
        if (cached) crop = cached;
        else {
          // Bounded thumbnail scan: remove only near-white margins, never alter source files.
          try {
            const sample = document.createElement('canvas'),
              scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
            sample.width = Math.max(1, Math.round(image.naturalWidth * scale));
            sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = sample.getContext('2d', { willReadFrequently: true })!;
            context.fillStyle = '#fff';
            context.fillRect(0, 0, sample.width, sample.height);
            context.drawImage(image, 0, 0, sample.width, sample.height);
            const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
            let left = sample.width,
              right = 0,
              top = sample.height,
              bottom = 0;
            for (let sy = 0; sy < sample.height; sy++)
              for (let sx = 0; sx < sample.width; sx++) {
                const i = (sy * sample.width + sx) * 4;
                if (pixels[i + 3] > 16 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 242) {
                  left = Math.min(left, sx);
                  right = Math.max(right, sx);
                  top = Math.min(top, sy);
                  bottom = Math.max(bottom, sy);
                }
              }
            if (left < right && top < bottom) {
              // Crop to the object, not the source canvas. Padding belongs in the
              // destination frame so it stays identical at every source resolution.
              right += 1;
              bottom += 1;
              crop = {
                x: (left / sample.width) * image.naturalWidth,
                y: (top / sample.height) * image.naturalHeight,
                w: ((right - left) / sample.width) * image.naturalWidth,
                h: ((bottom - top) / sample.height) * image.naturalHeight,
              };
            }
            sample.width = 0;
            sample.height = 0;
          } catch {
            /* Keep the full, uncropped photograph if pixels cannot be sampled. */
          }
          this.crops.set(image, crop);
        }
      }
      const inset = trim ? 0.02 : 0;
      x += w * inset;
      y += h * inset;
      w *= 1 - inset * 2;
      h *= 1 - inset * 2;
      const scale = Math.min(w / crop.w, h / crop.h),
        iw = crop.w * scale,
        ih = crop.h * scale;
      c.drawImage(
        image,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        x + (w - iw) / 2,
        y + (h - ih) / 2,
        iw,
        ih,
      );
    };
    const photo = async (product: StudioProduct, x: number, y: number, w: number, h: number) => {
      const image = await this.image(product.image);
      if (image) contain(image, x, y, w, h, settings.trimImages);
      else {
        this.warnings.add(`تصویر «${product.name}» در دسترس نیست`);
        if (strict && !settings.allowMissingImages)
          throw new Error(
            `تصویر «${product.name}» در دسترس نیست؛ آن را اصلاح کنید یا گزینهٔ جای‌نگهدار تصویر را فعال کنید.`,
          );
        box(x, y, w, h, '#edf2f7', 12);
        line('تصویر ثبت نشده', x + w / 2, y + h / 2 + 8, w - 20, 22, MUTED, 400, 'center');
      }
    };
    c.fillStyle = dark ? NAVY : '#eef2f6';
    c.fillRect(0, 0, W, H);
    if (dark) {
      const gradient = c.createLinearGradient(0, 0, W, H);
      gradient.addColorStop(0, '#153b5c');
      gradient.addColorStop(1, NAVY);
      c.fillStyle = gradient;
      c.fillRect(0, 0, W, H);
      c.strokeStyle = '#ffffff0b';
      c.lineWidth = 2;
      for (let r = 150; r < 1000; r += 90) {
        c.beginPath();
        c.arc(1080, H * 0.48, r, 0, 2 * Math.PI);
        c.stroke();
      }
    }
    const top = tall ? 158 : 48;
    const logo = await this.image(snapshot.branding.logo);
    if (logo) {
      c.save();
      c.beginPath();
      c.arc(978, top + 42, 42, 0, Math.PI * 2);
      c.clip();
      const side = Math.min(logo.naturalWidth, logo.naturalHeight);
      c.drawImage(
        logo,
        (logo.naturalWidth - side) / 2,
        (logo.naturalHeight - side) / 2,
        side,
        side,
        936,
        top,
        84,
        84,
      );
      c.restore();
    } else {
      box(936, top, 84, 84, '#fff', 42);
      if (snapshot.branding.logo)
        this.warnings.add('لوگوی فروشگاه بارگذاری نشد؛ نام فروشگاه حفظ شد');
      line(snapshot.branding.name[0] || 'س', 978, top + 56, 64, 40, INK, 700, 'center');
    }
    line(snapshot.branding.name, 912, top + 33, 820, 34, dark ? '#fff' : INK, 700, 'right', 24);
    line('قطعات خودرو | انتخاب مطمئن', 912, top + 69, 780, 22, dark ? '#bdd0e3' : MUTED);
    box(60, top + 110, 960, 2, dark ? '#ffffff22' : '#d6e0ea', 0);
    const cars = settings.showVehicles && settings.vehicles.trim();
    const b = snapshot.branding;
    const socials = [
      {
        kind: 'telegram' as const,
        value: b.telegram.replace(/^https?:\/\//i, '').split(/[?#]/)[0],
      },
      { kind: 'bale' as const, value: b.bale.replace(/^https?:\/\//i, '').split(/[?#]/)[0] },
    ].filter((social) => social.value);
    const footerHeight =
      24 +
      (cars ? 56 : 0) +
      (settings.cta ? 46 : 0) +
      (settings.showContacts
        ? (b.phones ? 40 : 0) + (b.website ? 32 : 0) + (socials.length ? 32 : 0)
        : 0) +
      (settings.showAddress && b.address ? 48 : 0) +
      40;
    const footerTop = H - footerHeight - (tall ? 140 : 0);
    // Frame titles stay above the product area; every output has its own pagination.
    const title =
      frame.kind === 'single'
        ? settings.title || frame.products[0].category
        : settings.title || 'منتخب قطعات خودرو';
    const titleY = top + 168;
    if (dark) {
      line(
        settings.showPrices ? 'فهرست قیمت و محصولات' : 'کاتالوگ محصولات',
        1020,
        titleY,
        960,
        26,
        accent,
        700,
      );
      const used = wrap(title, 1020, titleY + 96, 960, tall ? 84 : 72, '#fff', 700, 2);
      wrap(settings.subtitle, 1020, titleY + 118 + used, 960, 28, '#c5d6e5', 400, 2);
      const panelH = Math.min(tall ? 510 : 300, footerTop - (titleY + 118 + used + 90));
      if (panelH < 160)
        throw new Error(
          'فضای جلد کافی نیست؛ عنوان/پاورقی را کوتاه کنید یا اندازهٔ عمودی را انتخاب کنید',
        );
      const y = footerTop - panelH - 26,
        gap = 18,
        columns = frame.products.length,
        w = (960 - gap * (columns - 1)) / columns;
      for (let i = 0; i < frame.products.length; i++) {
        const x = 60 + (columns - 1 - i) * (w + gap);
        box(x, y, w, panelH, '#fff', 24);
        await photo(frame.products[i], x + 16, y + 16, w - 32, Math.max(60, panelH - 92));
        wrap(frame.products[i].name, x + w - 18, y + panelH - 48, w - 36, 20, INK, 700, 2);
      }
    } else {
      const titleUsed = wrap(title, 1020, titleY, 960, 40, INK, 700, 2);
      if (settings.subtitle) line(settings.subtitle, 1020, titleY + titleUsed + 8, 960, 22, MUTED);
      const start = titleY + titleUsed + (settings.subtitle ? 34 : 10);
      const bottom = footerTop - 24;
      if (bottom - start < 180)
        throw new Error('متن‌ها و پاورقی بیش از حد بلندند؛ زیرعنوان یا آدرس را کوتاه/خاموش کنید');
      if (frame.kind === 'single' || frame.products.length === 1) {
        const p = frame.products[0],
          v = studioPrice(p, variants[p.id]),
          h = bottom - start;
        box(60, start, 960, h, '#fff', 28);
        if (h < (settings.showVehicles ? 394 : 358))
          throw new Error('فضای طرح تک‌محصول کافی نیست؛ عنوان یا پاورقی را کوتاه کنید');
        const imageH = Math.max(120, h - (settings.showVehicles ? 274 : 238));
        await photo(p, 88, start + 20, 904, imageH);
        const nameY = start + imageH + 54;
        wrap(p.name, 990, nameY, 900, 38, INK, 700, 2);
        const meta = [
          settings.showCode ? p.code : '',
          settings.showBrands ? v.brand : '',
          settings.showAvailability ? (v.available ? 'موجود' : 'ناموجود') : '',
        ]
          .filter(Boolean)
          .join('  ·  ');
        line(meta, 990, nameY + 98, 900, 22, MUTED, 400, 'right', 18);
        if (settings.showVehicles) line(p.vehicles.join('، '), 990, nameY + 132, 900, 22, MUTED);
        priceLine(
          settings.showPrices && v.price
            ? `${v.from ? 'از ' : ''}${formatGroupedPersian(v.price)} ریال`
            : 'استعلام قیمت',
          990,
          nameY + 156 + (settings.showVehicles ? 36 : 0),
          900,
          44,
          settings.showPrices ? INK : accent,
          700,
          'right',
          28,
        );
      } else {
        const itemCount = frame.products.length;
        const cols =
          itemCount === 3
            ? format === 'square'
              ? 3
              : 1
            : format === 'square' && itemCount === 6
              ? 3
              : 2;
        const rows = Math.ceil(itemCount / cols),
          gap = 18,
          w = (960 - (cols - 1) * gap) / cols,
          h = (bottom - start - (rows - 1) * gap) / rows;
        if (h < (cols === 1 ? 218 : 204))
          throw new Error('فضای کارت‌ها کافی نیست؛ تعداد اقلام را کمتر یا پاورقی را کوتاه کنید');
        for (let i = 0; i < frame.products.length; i++) {
          const p = frame.products[i],
            v = studioPrice(p, variants[p.id]);
          const x =
              i === itemCount - 1 && itemCount % cols === 1
                ? 60 + (960 - w) / 2
                : 60 + (cols - 1 - (i % cols)) * (w + gap),
            y = start + Math.floor(i / cols) * (h + gap);
          box(x, y, w, h, '#fff', 22);
          if (cols === 1) {
            const imageW = Math.min(h - 32, 250);
            await photo(p, x + 16, y + 16, imageW, h - 32);
            const right = x + w - 24,
              tw = w - imageW - 64;
            wrap(p.name, right, y + 42, tw, 30, INK, 700, 2);
            const meta = [settings.showCode ? p.code : '', settings.showBrands ? v.brand : '']
              .filter(Boolean)
              .join(' · ');
            line(meta, right, y + 120, tw, 21, MUTED);
            priceLine(
              settings.showPrices && v.price
                ? `${v.from ? 'از ' : ''}${formatGroupedPersian(v.price)} ریال`
                : 'استعلام قیمت',
              right,
              y + h - 48,
              tw,
              30,
              INK,
              700,
              'right',
              22,
            );
            if (settings.showAvailability)
              line(
                v.available ? 'موجود' : 'ناموجود',
                right,
                y + h - 18,
                tw,
                18,
                v.available ? '#137658' : MUTED,
              );
          } else {
            const imageH = Math.max(44, h - 150);
            await photo(p, x + 14, y + 14, w - 28, imageH);
            wrap(p.name, x + w - 18, y + imageH + 40, w - 36, 23, INK, 700, 2);
            const meta = [
              settings.showCode ? p.code : '',
              settings.showBrands ? v.brand : '',
              settings.showAvailability ? (v.available ? 'موجود' : 'ناموجود') : '',
            ]
              .filter(Boolean)
              .join(' · ');
            line(meta, x + w - 18, y + h - 53, w - 36, 17, MUTED, 400, 'right', 16);
            priceLine(
              settings.showPrices && v.price
                ? `${v.from ? 'از ' : ''}${formatGroupedPersian(v.price)} ریال`
                : 'استعلام قیمت',
              x + w - 18,
              y + h - 20,
              w - 36,
              25,
              INK,
              700,
              'right',
              18,
            );
          }
        }
      }
    }
    // Footer is deliberately above native story/TikTok overlays, not against the canvas edge.
    box(60, footerTop, 960, 2, dark ? '#ffffff33' : '#ccd8e4', 0);
    const foreground = dark ? '#fff' : INK,
      muted = dark ? '#b4c8da' : MUTED;
    let fy = footerTop + 30;
    if (cars) {
      wrap(settings.vehicles, 540, fy, 960, 19, dark ? '#d6e5f1' : INK, 700, 2, 'center');
      fy += 56;
    }
    if (settings.cta) {
      contactLine('inquiry', settings.cta, fy, 21, foreground, 700);
      fy += 46;
    }
    if (settings.showContacts) {
      if (b.phones) {
        contactLine('phone', studioPersianDigits(b.phones), fy, 28, foreground, 700);
        fy += 40;
      }
      if (b.website) {
        contactLine(
          'website',
          b.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
          fy,
          24,
          foreground,
          700,
        );
        fy += 32;
      }
      socials.forEach((social, i) => {
        contactLine(
          social.kind,
          social.value,
          fy,
          20,
          muted,
          400,
          socials.length === 2 ? 780 - i * 480 : 540,
          socials.length === 2 ? 402 : 912,
        );
      });
      if (socials.length) fy += 32;
    }
    if (settings.showAddress && b.address) {
      drawStudioIcon(c, 'address', 994, fy - 19, 24, muted);
      wrap(b.address, 980, fy, 920, 18, muted, 400, 2);
      fy += 48;
    }
    const date = settings.showDate
      ? new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran' }).format(
          new Date(snapshot.capturedAt),
        )
      : '';
    line(
      `${settings.showPrices ? 'قیمت‌ها به ریال · ' : ''}تأیید نهایی قیمت و موجودی با فروشگاه${date ? ` · ${date}` : ''}`,
      1020,
      fy,
      870,
      16,
      muted,
    );
    line(
      `${formatPersianNumber(frame.number)} / ${formatPersianNumber(frame.total)}`,
      60,
      fy,
      80,
      17,
      foreground,
      700,
      'left',
    );
    checkStudioAbort(this.signal);
    return canvas;
  }
}
export function studioJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('ساخت فایل تصویر ناموفق بود'))),
      'image/jpeg',
      0.94,
    ),
  );
}
