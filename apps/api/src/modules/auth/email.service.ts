import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  async sendPasswordReset(to: string, name: string, link: string) {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) throw new ServiceUnavailableException('تنظیمات ایمیل کامل نیست');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE !== 'false',
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? user,
      to,
      subject: 'بازیابی رمز عبور پنل سلیم وند',
      text: `سلام ${name}\n\nبرای تعیین رمز عبور جدید روی لینک زیر کلیک کنید:\n${link}\n\nاین لینک تا ۳۰ دقیقه معتبر است.`,
      html: `<div dir="rtl"><p>سلام ${name}</p><p>برای تعیین رمز عبور جدید روی دکمه زیر کلیک کنید:</p><p><a href="${link}">بازیابی رمز عبور</a></p><p>این لینک تا ۳۰ دقیقه معتبر است.</p></div>`,
    });
  }
}
