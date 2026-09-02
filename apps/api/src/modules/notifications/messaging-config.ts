/**
 * Messaging credentials live in the `settings` table (key below) so the
 * operator can configure sms.ir, Telegram and Bale from the admin panel
 * without any server access. Values in `.env` remain as a fallback and are
 * only used for fields the panel has not saved yet.
 */
export const MESSAGING_SETTINGS_KEY = 'integrations.messaging';

/** Prefix used to mask secrets in API responses and merge-safe round-trips. */
export const SECRET_MASK_PREFIX = '••••';

export type MessagingConfig = {
  sms?: { apiKey?: string; lineNumber?: string };
  telegram?: { botToken?: string; chatId?: string };
  bale?: { botToken?: string; chatId?: string };
};

function asString(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Coerces an arbitrary JSON value from the settings table into a safe shape. */
export function asMessagingConfig(value: unknown): MessagingConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const pick = (channel: unknown): Record<string, unknown> =>
    channel && typeof channel === 'object' ? (channel as Record<string, unknown>) : {};
  const sms = pick(raw.sms);
  const telegram = pick(raw.telegram);
  const bale = pick(raw.bale);
  return {
    sms: { apiKey: asString(sms.apiKey), lineNumber: asString(sms.lineNumber) },
    telegram: { botToken: asString(telegram.botToken), chatId: asString(telegram.chatId) },
    bale: { botToken: asString(bale.botToken), chatId: asString(bale.chatId) },
  };
}

/** Masks the secret fields so GET /settings never exposes raw keys or tokens. */
export function maskMessagingSecrets(value: unknown): MessagingConfig {
  const config = asMessagingConfig(value);
  const mask = (secret?: string) => (secret ? `${SECRET_MASK_PREFIX}${secret.slice(-4)}` : '');
  return {
    sms: { apiKey: mask(config.sms?.apiKey), lineNumber: config.sms?.lineNumber },
    telegram: { botToken: mask(config.telegram?.botToken), chatId: config.telegram?.chatId },
    bale: { botToken: mask(config.bale?.botToken), chatId: config.bale?.chatId },
  };
}

/**
 * Merges the payload coming from the panel with what is stored: a masked value
 * or an absent field means «keep the stored secret», anything else replaces it.
 * Empty strings are normalized away, so clearing a value falls back to `.env`.
 */
export function mergeMessagingSecrets(incoming: unknown, existing: unknown): MessagingConfig {
  const next = asMessagingConfig(incoming);
  const current = asMessagingConfig(existing);
  const secret = (received?: string, stored?: string) =>
    received === undefined || received.startsWith(SECRET_MASK_PREFIX) ? stored : received;
  return {
    sms: {
      apiKey: secret(next.sms?.apiKey, current.sms?.apiKey),
      lineNumber: next.sms?.lineNumber ?? current.sms?.lineNumber,
    },
    telegram: {
      botToken: secret(next.telegram?.botToken, current.telegram?.botToken),
      chatId: next.telegram?.chatId ?? current.telegram?.chatId,
    },
    bale: {
      botToken: secret(next.bale?.botToken, current.bale?.botToken),
      chatId: next.bale?.chatId ?? current.bale?.chatId,
    },
  };
}

export type MessagingSettingsReader = {
  findUnique: (args: { where: { key: string } }) => Promise<{ value: unknown } | null>;
};

/**
 * Effective environment for the notification adapters: panel-configured values
 * take precedence and `.env` fills the gaps. A database failure keeps messaging
 * running on the `.env` values instead of breaking it.
 */
export async function resolveMessagingEnv(
  settings?: MessagingSettingsReader,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (!settings) return env;
  try {
    const row = await settings.findUnique({ where: { key: MESSAGING_SETTINGS_KEY } });
    const config = asMessagingConfig(row?.value);
    if (config.sms?.apiKey) env.SMS_API_KEY = config.sms.apiKey;
    if (config.sms?.lineNumber) env.SMS_LINE_NUMBER = config.sms.lineNumber;
    if (config.telegram?.botToken) env.TELEGRAM_BOT_TOKEN = config.telegram.botToken;
    if (config.telegram?.chatId) env.TELEGRAM_CHAT_ID = config.telegram.chatId;
    if (config.bale?.botToken) env.BALE_BOT_TOKEN = config.bale.botToken;
    if (config.bale?.chatId) env.BALE_CHAT_ID = config.bale.chatId;
  } catch {
    // The settings lookup is best-effort; `.env` remains the fallback.
  }
  return env;
}
