import { useState } from 'react';
import { miniAppLaunchUrl, miniAppPath, type MiniAppSettings } from '@salimvand/shared';
import { publicSiteUrl } from '../lib/public-site';

export function MiniAppSettingsEditor({
  value,
  onChange,
}: {
  value: MiniAppSettings;
  onChange: (value: MiniAppSettings) => void;
}) {
  const [message, setMessage] = useState('');
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('کپی شد.');
    } catch {
      setMessage('کپی خودکار در دسترس نیست؛ متن آدرس را انتخاب و کپی کنید.');
    }
  };
  return (
    <fieldset className="miniapp-settings">
      <legend>مینی‌اپ فروشگاه در تلگرام و بله</legend>
      <p className="muted">
        یک کاتالوگ مشترک با اطلاعات و قیمت‌های عمومی سایت؛ بدون ثبت دوبارهٔ محصول. ابتدا مینی‌اپ
        اصلی را در BotFather همان پیام‌رسان فعال و آزمایش کنید، سپس دکمهٔ کانال را فعال کنید.
      </p>
      {(['telegram', 'bale'] as const).map((platform) => {
        const label = platform === 'telegram' ? 'تلگرام' : 'بله';
        const field = platform === 'telegram' ? 'telegramBotUsername' : 'baleBotUsername';
        const url = `${publicSiteUrl}${miniAppPath(platform)}`;
        const launch = miniAppLaunchUrl({ ...value, channelButtonsEnabled: true }, platform);
        return (
          <section key={platform} className="miniapp-settings-platform">
            <h3>{label}</h3>
            <label>
              نام کاربری ربات/بازوی {label}
              <input
                dir="ltr"
                value={value[field]}
                maxLength={33}
                placeholder="@your_store_bot"
                autoComplete="off"
                onChange={(event) => onChange({ ...value, [field]: event.target.value })}
              />
            </label>
            <label>
              آدرس وب مینی‌اپ {label} برای BotFather
              <input readOnly dir="ltr" value={url} />
            </label>
            <div className="miniapp-settings-actions">
              <button type="button" onClick={() => void copy(url)}>
                کپی آدرس وب {label}
              </button>
              <a className="button" href={url} target="_blank" rel="noreferrer">
                پیش‌نمایش {label}
              </a>
            </div>
            {launch && (
              <>
                <label>
                  لینک اجرای مینی‌اپ {label} برای کانال
                  <input readOnly dir="ltr" value={launch} />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void copy(
                      `🛍 کاتالوگ محصولات فروشگاه\nجست‌وجو، موجودی و استعلام قطعه:\n${launch}`,
                    )
                  }
                >
                  کپی متن پیام سنجاق‌شدهٔ {label}
                </button>
              </>
            )}
          </section>
        );
      })}
      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.channelButtonsEnabled}
          onChange={(event) => onChange({ ...value, channelButtonsEnabled: event.target.checked })}
        />
        دکمهٔ کاتالوگ در پست‌های جدید کانال، مینی‌اپ را باز کند
      </label>
      <label>
        متن دکمهٔ کانال
        <input
          value={value.buttonText}
          maxLength={48}
          onChange={(event) => onChange({ ...value, buttonText: event.target.value })}
        />
      </label>
      <small className="muted">
        تغییرات را ذخیره کنید. برای پیام‌رسانی که نام ربات ندارد، دکمهٔ سایت حفظ می‌شود. پست‌های
        قبلی تغییر نمی‌کنند؛ پیام معرفی را می‌توانید خودتان در کانال سنجاق کنید. توکن ربات را اینجا
        وارد نکنید؛ تنظیمات محرمانه در بخش پیامک و کانال‌ها باقی می‌ماند.
      </small>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
