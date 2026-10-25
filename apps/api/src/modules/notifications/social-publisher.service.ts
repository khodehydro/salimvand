import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { baladDirectionsUrl, parseCoordinate, parseMiniAppSettings, miniAppLaunchUrl } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';
import { resolveMessagingEnv, type MessagingSettingsReader } from './messaging-config';
import { telegramApiHeaders } from './notifications.service';
import { createChannelPhoto, storeChannelPhoto, type ChannelBrand } from './channel-photo';

export type SocialPlatform = 'telegram' | 'bale';
export type ButtonStyle = 'primary' | 'success' | 'danger';
export type SocialButton = { text: string; url: string; style?: ButtonStyle };

export type ProductPostInput = {
  name: string;
  code: string;
  vehicles: string[];
  phones?: string;
  address?: string;
  navUrl?: string | null;
  aparatVideoId?: string | null;
  imageUrl?: string | null;
  siteUrl: string;
  miniAppLinks?: Partial<Record<SocialPlatform, string>>;
  miniAppButtonText?: string;
  adminUsername: string;
  telegramAdminUsername?: string;
  baleAdminUsername?: string;
};

export type PublishChannelResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
};
export type PublishResult = {
  caption: string;
  telegram: PublishChannelResult;
  bale: PublishChannelResult;
};

export const DEFAULT_SOCIAL_ADMIN_USERNAME = 'salimvandiradmin2';
const PUBLISH_TIMEOUT_MS = 20_000;

/** Aparat watch page for a stored video id. */
export function aparatUrl(videoId: string): string {
  return `https://www.aparat.com/v/${videoId}`;
}

/** Deep link that opens a private chat with the store admin on the platform. */
export function adminPmUrl(platform: SocialPlatform, username: string): string {
  return platform === 'telegram' ? `https://t.me/${username}` : `https://ble.ir/${username}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Caption of the channel post: name, code, vehicles, phone and address. */
export function buildProductCaption(
  post: ProductPostInput,
  platform: SocialPlatform = 'telegram',
): string {
  const isTg = platform === 'telegram';
  const escape = isTg ? escapeHtml : (s: string) => s;

  // 1) Product specifications
  const lines = [`🛠 ${escape(post.name)}`, '', `🔖 کد محصول: ${escape(post.code)}`];
  if (post.vehicles.length) {
    lines.push(`🚗 مناسب برای خودروهای: ${escape(post.vehicles.join('، '))}`);
  }

  // 2) Store info box (separated from specifications)
  const hasStoreInfo = Boolean(post.phones?.trim() || post.address?.trim());
  if (hasStoreInfo) {
    lines.push('');
    lines.push('──────────────');

    if (post.phones?.trim()) {
      const rawPhones = post.phones
        .split(/[,،/\n]+/)
        .map((p) => p.trim())
        .filter(Boolean);

      const formattedPhones = rawPhones.length
        ? rawPhones
            .map((phone) => (isTg ? `<code>${escapeHtml(phone)}</code>` : `\`${phone}\``))
            .join('  |  ')
        : isTg
          ? `<code>${escapeHtml(post.phones.trim())}</code>`
          : `\`${post.phones.trim()}\``;

      lines.push(`📞 تماس (کلیک جهت کپی): ${formattedPhones}`);
    }

    if (post.address?.trim()) {
      lines.push(`📍 ${escape(post.address.trim())}`);
    }
  }

  return lines.join('\n').slice(0, 1024);
}

/**
 * Inline keyboard under the post. Telegram renders these as the «دکمه‌های
 * شیشه‌ای»; Bale's bot API accepts the same structure. The video button only
 * exists when the product has an Aparat video registered in the panel, and
 * the «مسیریابی سریع» button only appears when the store coordinates are
 * configured — exactly like the mobile site's navigation button.
 */
export function buildProductKeyboard(
  post: ProductPostInput,
  platform: SocialPlatform,
): SocialButton[][] {
  const isTg = platform === 'telegram';
  const customAdmin = isTg ? post.telegramAdminUsername : post.baleAdminUsername;
  const rawAdmin =
    customAdmin?.trim() || post.adminUsername?.trim() || DEFAULT_SOCIAL_ADMIN_USERNAME;
  const cleanAdmin = rawAdmin.replace(/^@+/, '').trim();

  const rows: SocialButton[][] = [
    [
      {
        text: '🛒 استعلام و خرید',
        url: adminPmUrl(platform, cleanAdmin),
        ...(isTg ? { style: 'success' as const } : {}),
      },
    ],
  ];
  if (post.aparatVideoId?.trim())
    rows.push([
      {
        text: '🎬 نمایش ویدیو',
        url: aparatUrl(post.aparatVideoId.trim()),
        ...(isTg ? { style: 'primary' as const } : {}),
      },
    ]);
  const lastRow: SocialButton[] = [
    {
      text: post.miniAppLinks?.[platform] ? post.miniAppButtonText || '🛍 فروشگاه داخل پیام‌رسان' : '📦 کاتالوگ محصولات',
      url: post.miniAppLinks?.[platform] || post.siteUrl,
      ...(isTg ? { style: 'primary' as const } : {}),
    },
  ];
  if (post.navUrl)
    lastRow.push({
      text: '🧭 مسیریابی سریع',
      url: post.navUrl,
      ...(isTg ? { style: 'primary' as const } : {}),
    });
  rows.push(lastRow);
  return rows;
}

/** Readable failure text for the panel, from provider errors. */
export function publishFailure(status: number, description?: string | null): string {
  if (status === 401) return 'توکن ربات نامعتبر است';
  if (status === 403) return 'ربات به کانال دسترسی ندارد؛ ربات را مدیر کانال کنید';
  if (status === 429) return 'تعداد درخواست زیاد است؛ کمی بعد دوباره تلاش کنید';
  const detail = description?.trim();
  if (detail) return detail.replace(/^bad request: /i, '').slice(0, 200);
  return `HTTP ${status}`;
}

type StoreProfile = ChannelBrand & {
  phones?: string;
  address?: string;
  navLat?: string;
  navLng?: string;
};

/**
 * Publishes a product announcement to the Telegram and Bale channels.
 * Telegram goes through TELEGRAM_API_BASE (the Cloudflare Worker proxy in
 * production, since api.telegram.org is filtered inside Iran); Bale is called
 * directly on tapi.bale.ai.
 */
@Injectable()
export class SocialPublisherService {
  constructor(private readonly prisma: PrismaService) {}

  private messagingEnv(): Promise<NodeJS.ProcessEnv> {
    return resolveMessagingEnv(
      this.prisma?.setting as unknown as MessagingSettingsReader | undefined,
    );
  }

  async publishProduct(
    productIdOrItemId: string,
    platforms: SocialPlatform[] = ['telegram', 'bale'],
  ): Promise<PublishResult> {
    let product = await this.prisma.product.findUnique({
      where: { id: productIdOrItemId },
      include: {
        images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
        compatibilities: { include: { model: { include: { make: true } }, trim: true } },
      },
    });

    if (!product && this.prisma?.inventoryItem) {
      // In case an inventory item ID was passed from warehouse list / mobile client
      const item = await this.prisma.inventoryItem.findUnique({
        where: { id: productIdOrItemId },
        select: { productId: true },
      });
      if (item?.productId) {
        product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          include: {
            images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
            compatibilities: { include: { model: { include: { make: true } }, trim: true } },
          },
        });
      }
    }

    if (!product || product.deletedAt) throw new NotFoundException('محصول پیدا نشد');

    const env = await this.messagingEnv();
    const configured =
      (platforms.includes('telegram') && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) ||
      (platforms.includes('bale') && env.BALE_BOT_TOKEN && env.BALE_CHAT_ID);
    if (!configured)
      throw new BadRequestException(
        'برای انتشار، ابتدا توکن ربات و آیدی کانال تلگرام یا بله را در پنل (پیامک و کانال‌ها ← پیکربندی) ذخیره کنید',
      );

    const profile = (await this.prisma.setting.findUnique({ where: { key: 'store.profile' } }))
      ?.value as StoreProfile | null;
    const miniapp = parseMiniAppSettings((await this.prisma.setting.findUnique({ where: { key: 'store.miniapp' } }))?.value);
    const siteUrl = (env.PUBLIC_SITE_URL ?? 'https://salimvand.ir').replace(/\/+$/, '');
    const image = product.images[0];
    const vehicles = [
      ...new Set(
        product.compatibilities.map(
          (compat) =>
            `${compat.model.make.name} ${compat.model.name}${compat.trim ? ` ${compat.trim.name}` : ''}`,
        ),
      ),
    ];
    // Same rule as the mobile site's «مسیریابی سریع» button: it appears only
    // when the store coordinates (navLat/navLng) are configured in settings.
    const navLat = parseCoordinate(profile?.navLat ?? '');
    const navLng = parseCoordinate(profile?.navLng ?? '');
    const navUrl = navLat != null && navLng != null ? baladDirectionsUrl(navLat, navLng) : null;
    const post: ProductPostInput = {
      name: product.name,
      code: product.code,
      vehicles,
      phones: profile?.phones,
      address: profile?.address,
      navUrl,
      aparatVideoId: product.aparatVideoId,
      imageUrl: image ? `${siteUrl}${image.path}` : null,
      siteUrl,
      miniAppLinks: miniapp ? {
        telegram: miniAppLaunchUrl(miniapp, 'telegram') ?? undefined,
        bale: miniAppLaunchUrl(miniapp, 'bale') ?? undefined,
      } : undefined,
      miniAppButtonText: miniapp?.buttonText,
      adminUsername: env.SOCIAL_ADMIN_USERNAME ?? DEFAULT_SOCIAL_ADMIN_USERNAME,
      telegramAdminUsername: env.TELEGRAM_ADMIN_USERNAME,
      baleAdminUsername: env.BALE_ADMIN_USERNAME,
    };
    const telegramCaption = buildProductCaption(post, 'telegram');
    const baleCaption = buildProductCaption(post, 'bale');

    // Generate once and share the same watermarked copy between providers.
    // A rendering error must never silently publish an unbranded original.
    let photo: Buffer | undefined;
    if (image) {
      try {
        photo = await createChannelPhoto(image.path, profile ?? {});
      } catch {
        throw new BadRequestException(
          'ساخت تصویر واترمارک‌دار ناموفق بود؛ تصویر محصول و آیکون فروشگاه را بررسی کنید',
        );
      }
    }
    const [telegram, bale] = await Promise.all([
      platforms.includes('telegram')
        ? this.send('telegram', env, post, telegramCaption, photo)
        : Promise.resolve({ ok: false, skipped: true, reason: 'انتخاب نشده' }),
      platforms.includes('bale')
        ? this.send('bale', env, post, baleCaption, photo)
        : Promise.resolve({ ok: false, skipped: true, reason: 'انتخاب نشده' }),
    ]);
    return { caption: telegramCaption, telegram, bale };
  }

  private async send(
    platform: SocialPlatform,
    env: NodeJS.ProcessEnv,
    post: ProductPostInput,
    caption: string,
    photo?: Buffer,
  ): Promise<PublishChannelResult> {
    const token = platform === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN;
    const chatId = platform === 'telegram' ? env.TELEGRAM_CHAT_ID : env.BALE_CHAT_ID;
    if (!token || !chatId) return { ok: false, skipped: true, reason: 'پیکربندی نشده' };

    const base =
      platform === 'telegram'
        ? (env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')
        : 'https://tapi.bale.ai';
    let telegramPhotoUrl: string | undefined;
    if (photo && platform === 'telegram') {
      try {
        telegramPhotoUrl = await storeChannelPhoto(photo, post.siteUrl);
      } catch (error) {
        // Expose only recognized filesystem codes, never raw error messages
        // (which can contain server paths or a misconfigured credential URL).
        const code = (error as NodeJS.ErrnoException | null)?.code;
        const safeCode = [
          'EACCES',
          'EPERM',
          'ENOSPC',
          'EROFS',
          'ENOENT',
          'ENOTDIR',
          'EDQUOT',
        ].includes(code ?? '')
          ? ` (${code})`
          : '';
        const result = {
          ok: false,
          reason: `ذخیرهٔ نسخهٔ واترمارک‌دار برای تلگرام ناموفق بود${safeCode}`,
        };
        await this.log(platform, chatId, caption, result).catch(() => undefined);
        return result;
      }
    }
    const method = photo ? 'sendPhoto' : 'sendMessage';
    const payload = {
      chat_id: chatId,
      ...(platform === 'telegram' ? { parse_mode: 'HTML' } : {}),
      ...(photo ? { caption } : { text: caption }),
      ...(telegramPhotoUrl ? { photo: telegramPhotoUrl } : {}),
      reply_markup: { inline_keyboard: buildProductKeyboard(post, platform) },
    };
    const headers =
      platform === 'telegram' ? telegramApiHeaders(env) : { 'content-type': 'application/json' };
    let requestBody: string | FormData = JSON.stringify(payload);
    if (photo && platform === 'bale') {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      form.set('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'product.jpg');
      // Bale accepts direct uploads; fetch supplies the multipart boundary.
      delete headers['content-type'];
      requestBody = form;
    }
    let result: PublishChannelResult;
    try {
      const response = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;
      result =
        response.ok && body?.ok !== false
          ? { ok: true }
          : { ok: false, reason: publishFailure(response.status, body?.description) };
    } catch (error) {
      const reason =
        (error as Error)?.name === 'TimeoutError'
          ? 'پاسخی به‌موقع نرسید (تایم‌اوت)'
          : `خطای اتصال (${(error as Error)?.message ?? 'نامشخص'})`;
      result = { ok: false, reason };
    }
    await this.log(platform, chatId, caption, result).catch(() => undefined);
    return result;
  }

  /** Delivery record for the panel's channel logs. */
  private async log(
    platform: SocialPlatform,
    chatId: string,
    caption: string,
    result: PublishChannelResult,
  ) {
    if (!this.prisma?.telegramLog?.create) return;
    await this.prisma.telegramLog.create({
      data: {
        channel: platform,
        chatId: chatId.slice(0, 60),
        message: caption.slice(0, 2000),
        status: result.ok ? 'sent' : 'failed',
        error: result.ok ? null : ((result.reason ?? null)?.slice(0, 500) ?? null),
      },
    });
  }
}
