import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { baladDirectionsUrl, parseCoordinate } from '@salimvand/shared';
import { PrismaService } from '../../prisma.service';
import { resolveMessagingEnv, type MessagingSettingsReader } from './messaging-config';
import { telegramApiHeaders } from './notifications.service';

export type SocialPlatform = 'telegram' | 'bale';
export type SocialButton = { text: string; url: string };

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
  adminUsername: string;
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

/** Caption of the channel post: name, code, vehicles, phone and address. */
export function buildProductCaption(post: ProductPostInput): string {
  const lines = [`🛠 ${post.name}`, '', `🔖 کد محصول: ${post.code}`];
  if (post.vehicles.length) lines.push(`🚗 مناسب برای خودروهای: ${post.vehicles.join('، ')}`);
  if (post.phones?.trim()) lines.push(`📞 ${post.phones.trim()}`);
  if (post.address?.trim()) lines.push(`📍 ${post.address.trim()}`);
  return lines.join('\n').slice(0, 1000);
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
  const rows: SocialButton[][] = [
    [{ text: '🛒 استعلام و خرید', url: adminPmUrl(platform, post.adminUsername) }],
  ];
  if (post.aparatVideoId?.trim())
    rows.push([{ text: '🎬 نمایش ویدیو', url: aparatUrl(post.aparatVideoId.trim()) }]);
  const lastRow: SocialButton[] = [{ text: '📦 کاتالوگ محصولات', url: post.siteUrl }];
  if (post.navUrl) lastRow.push({ text: '🧭 مسیریابی سریع', url: post.navUrl });
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

type StoreProfile = {
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

  async publishProduct(productId: string): Promise<PublishResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        images: { orderBy: [{ isPrimary: 'desc' }, { sort: 'asc' }], take: 1 },
        compatibilities: { include: { model: { include: { make: true } }, trim: true } },
      },
    });
    if (!product || product.deletedAt) throw new NotFoundException('محصول پیدا نشد');

    const env = await this.messagingEnv();
    const configured =
      (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) || (env.BALE_BOT_TOKEN && env.BALE_CHAT_ID);
    if (!configured)
      throw new BadRequestException(
        'برای انتشار، ابتدا توکن ربات و آیدی کانال تلگرام یا بله را در پنل (پیامک و کانال‌ها ← پیکربندی) ذخیره کنید',
      );

    const profile = (await this.prisma.setting.findUnique({ where: { key: 'store.profile' } }))
      ?.value as StoreProfile | null;
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
      adminUsername: env.SOCIAL_ADMIN_USERNAME ?? DEFAULT_SOCIAL_ADMIN_USERNAME,
    };
    const caption = buildProductCaption(post);

    const [telegram, bale] = await Promise.all([
      this.send('telegram', env, post, caption),
      this.send('bale', env, post, caption),
    ]);
    return { caption, telegram, bale };
  }

  private async send(
    platform: SocialPlatform,
    env: NodeJS.ProcessEnv,
    post: ProductPostInput,
    caption: string,
  ): Promise<PublishChannelResult> {
    const token = platform === 'telegram' ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN;
    const chatId = platform === 'telegram' ? env.TELEGRAM_CHAT_ID : env.BALE_CHAT_ID;
    if (!token || !chatId) return { ok: false, skipped: true, reason: 'پیکربندی نشده' };

    const base =
      platform === 'telegram'
        ? (env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '')
        : 'https://tapi.bale.ai';
    const method = post.imageUrl ? 'sendPhoto' : 'sendMessage';
    const payload = {
      chat_id: chatId,
      ...(post.imageUrl ? { photo: post.imageUrl, caption } : { text: caption }),
      reply_markup: { inline_keyboard: buildProductKeyboard(post, platform) },
    };
    let result: PublishChannelResult;
    try {
      const response = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers:
          platform === 'telegram'
            ? telegramApiHeaders(env)
            : { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
