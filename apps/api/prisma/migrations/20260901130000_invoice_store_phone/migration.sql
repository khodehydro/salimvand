-- Store contact details are snapshotted from the settings store profile at
-- issue time so every invoice carries the phone/address that was valid then.
ALTER TABLE "invoices" ADD COLUMN "storePhone" TEXT;
