import { PrismaClient, UserRole } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
async function main() {
  const category = await prisma.category.upsert({ where: { code: 'INT' }, update: {}, create: { name: 'لوازم داخلی خودرو', slug: 'lavazem-dakheli-khodro', code: 'INT' } });
  await prisma.brand.upsert({ where: { name: 'سلیم وند' }, update: {}, create: { name: 'سلیم وند' } });
  await prisma.vehicleMake.upsert({ where: { name: 'ایران خودرو' }, update: {}, create: { name: 'ایران خودرو', models: { create: [{ name: 'پژو ۲۰۶' }, { name: 'پژو ۴۰۵' }, { name: 'سمند' }, { name: 'دنا' }] } } });
  await prisma.counter.upsert({ where: { key: 'product' }, update: {}, create: { key: 'product' } });
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminPassword) {
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await prisma.user.upsert({ where: { username: process.env.SEED_ADMIN_USERNAME ?? 'admin' }, update: { passwordHash, role: UserRole.super_admin, isActive: true }, create: { name: process.env.SEED_ADMIN_NAME ?? 'مدیر سیستم', username: process.env.SEED_ADMIN_USERNAME ?? 'admin', passwordHash, role: UserRole.super_admin, isActive: true } });
    console.log('Seeded the initial admin user.');
  } else {
    console.log('Seeded references; SEED_ADMIN_PASSWORD was not set, so no admin was created.');
  }
}
main().finally(() => prisma.$disconnect());
