import { Zip, ZipPassThrough } from 'fflate';
import {
  STUDIO_FORMATS,
  studioFolder,
  studioFrames,
  type StudioSnapshot,
  type StudioSettings,
} from '@salimvand/shared';
import { checkStudioAbort, StudioRenderer, studioJpeg } from './render';
export function saveStudioBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}
/** JPEGs are stored, not recompressed. Only one full-size canvas + 16 source images are kept live. */
export async function exportStudio(
  snapshot: StudioSnapshot,
  settings: StudioSettings,
  variants: Record<string, string>,
  folderName: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
) {
  const frames = studioFrames(snapshot.products, settings);
  if (!frames.length) throw new Error('حداقل یک محصول انتخاب کنید');
  for (const p of snapshot.products)
    if (variants[p.id] && !p.variants.some((v) => v.id === variants[p.id]))
      throw new Error(`برند انتخابی «${p.name}» تغییر کرده؛ فهرست را دوباره دریافت کنید`);
  const chunks: ArrayBuffer[] = [];
  let bytes = 0,
    error: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      error = err;
      return;
    }
    bytes += data.byteLength;
    if (bytes > 180 * 1024 * 1024) {
      error = new Error('حجم خروجی بیش از ۱۸۰ مگابایت شد؛ تعداد محصولات یا اندازه‌ها را کمتر کنید');
      return;
    }
    chunks.push(new Uint8Array(data).buffer);
  });
  const renderer = new StudioRenderer(signal),
    folder = studioFolder(folderName),
    total = frames.length * settings.formats.length;
  const add = (path: string, data: Uint8Array) => {
    const file = new ZipPassThrough(path);
    zip.add(file);
    file.push(data, true);
    if (error) throw error;
  };
  let done = 0;
  try {
    progress(0, total);
    for (const format of settings.formats)
      for (const frame of frames) {
        checkStudioAbort(signal);
        const canvas = await renderer
          .render(frame, format, snapshot, settings, variants, true)
          .catch((error: unknown) => {
            checkStudioAbort(signal);
            throw new Error(
              `${STUDIO_FORMATS[format].label}، تصویر ${frame.number}: ${error instanceof Error ? error.message : 'ساخت تصویر انجام نشد'}`,
            );
          });
        try {
          const blob = await studioJpeg(canvas);
          checkStudioAbort(signal);
          const size = STUDIO_FORMATS[format];
          const dir = settings.formats.length > 1 ? `${format}-${size.width}x${size.height}/` : '';
          add(
            `${folder}/${dir}${String(frame.number).padStart(3, '0')}-${frame.kind}.jpg`,
            new Uint8Array(await blob.arrayBuffer()),
          );
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        progress(++done, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    add(
      `${folder}/راهنمای-خروجی.txt`,
      new TextEncoder().encode(
        `ساخته‌شده برای: ${snapshot.branding.name}\nزمان دریافت داده: ${snapshot.capturedAt}\nمحصولات: ${snapshot.products.length}\nقیمت: ${!settings.showPriceInfo ? 'بدون قیمت و برچسب استعلام' : settings.showPrices ? 'قیمت فروش به ریال؛ انتخاب صریح مدیر، مستقل از نمایش قیمت سایت' : 'استعلام؛ بدون درج قیمت'}\nانتشار خودکار انجام نشده است. تصاویر مربوط به زمان دریافت اطلاعات‌اند.\n${[...renderer.warnings].join('\n')}`,
      ),
    );
    checkStudioAbort(signal);
    zip.end();
    if (error) throw error;
    return {
      blob: new Blob(chunks, { type: 'application/zip' }),
      filename: `${folder}.zip`,
      warnings: [...renderer.warnings],
    };
  } finally {
    zip.terminate();
    renderer.dispose();
  }
}
