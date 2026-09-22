-- Locations with a blank code/name showed up in consumers as
-- «بدون نام — <type> <id>». The API has always rejected blanks on create
-- and update, so these rows predate that guard (or came from manual SQL).
-- Backfill what can be backfilled, drop disconnected ghosts, label the
-- connected ones, then lock the table so blanks can never return.

-- ۱) نامِ خالی را از کدِ سالم پر کن (کد تکراری نمی‌سازد؛ name فقط منحصربه‌فرد نیست)
UPDATE "locations" SET "name" = "code"
WHERE btrim(coalesce("name", '')) = '' AND btrim(coalesce("code", '')) <> '';

-- ۲) کدِ خالی را از نام پر کن — محدود به ۲۰ نویسهٔ VarChar و یکتا در همان والد
--    (locations دارای @@unique([parentId, code]) است، پس تکرار باید دور زده شود).
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT id, "parentId", btrim("name") AS nm
    FROM "locations"
    WHERE btrim(coalesce("code", '')) = '' AND btrim(coalesce("name", '')) <> ''
  LOOP
    -- btrim: برشِ نویسهٔ بیستم نباید فاصلهٔ انتهایی جا بگذارد (آرایشی،
    -- ولی کدِ تمیز در بارکد و لیبل‌ها بهتر چاپ می‌شود).
    candidate := btrim(left(r.nm, 20));
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "locations" x
      WHERE x."parentId" IS NOT DISTINCT FROM r."parentId"
        AND x."code" = candidate
        AND x.id <> r.id
    ) LOOP
      n := n + 1;
      -- پایه را قبل از چسباندن پسوند بتراش تا «… ‎-2» با فاصله ساخته نشود.
      candidate := left(btrim(left(r.nm, 17)) || '-' || n::text, 20);
    END LOOP;
    UPDATE "locations" SET "code" = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- ۳) ردیف‌های هر دو خالی که هیچ کالا یا قفسهٔ فرزندی به آنها وصل نیست → حذف
DELETE FROM "locations" l
WHERE btrim(coalesce("code", '')) = ''
  AND btrim(coalesce("name", '')) = ''
  AND NOT EXISTS (SELECT 1 FROM "inventory_items" i WHERE i."locationId" = l.id)
  AND NOT EXISTS (SELECT 1 FROM "locations" c WHERE c."parentId" = l.id);

-- ۴) ردیف‌های هر دو خالیِ متصل (کالا یا فرزند دارند) → کد/نام تولید شده بگیرند
--    تا جای کالاهای موجود معنا داشته باشند؛ کد از ۸ نویسهٔ اول uuid ساخته می‌شود.
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT id, "parentId" FROM "locations"
    WHERE btrim(coalesce("code", '')) = '' AND btrim(coalesce("name", '')) = ''
  LOOP
    candidate := 'LOC-' || left(r.id::text, 8);
    n := 0;
    WHILE EXISTS (
      SELECT 1 FROM "locations" x
      WHERE x."parentId" IS NOT DISTINCT FROM r."parentId"
        AND x."code" = candidate
        AND x.id <> r.id
    ) LOOP
      n := n + 1;
      candidate := left('LOC-' || left(r.id::text, 8) || '-' || n::text, 20);
    END LOOP;
    UPDATE "locations" SET "code" = candidate, "name" = 'مکان ' || candidate
    WHERE id = r.id;
  END LOOP;
END $$;

-- ۵) قیدهای دیتابیس: کد و نام هرگز خالی/فاصله‌ای نباشند (مثل guardهای API)
ALTER TABLE "locations" ADD CONSTRAINT "locations_code_not_blank" CHECK (btrim("code") <> '');
ALTER TABLE "locations" ADD CONSTRAINT "locations_name_not_blank" CHECK (btrim("name") <> '');
