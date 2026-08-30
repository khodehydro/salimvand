#!/usr/bin/env node
/**
 * Offline migration validator.
 *
 * Replays every migration in apps/api/prisma/migrations (plain SQL, in folder
 * order — exactly what `prisma migrate deploy` does) against a throwaway
 * embedded Postgres instance, then compares information_schema with
 * prisma/schema.prisma for every model: column names (including @map),
 * tables (@@map) and required-vs-nullable.
 *
 * Why: hand-written migrations can drift from the Prisma schema in ways that
 * neither `prisma validate` nor the unit tests catch (the test suite mocks
 * Prisma, so a column named price_display where the client expects
 * priceDisplay only explodes on a real database). This script catches that
 * class of bug before a deploy does.
 *
 * Usage (needs a one-off install; keeps the lockfile untouched):
 *   cd $(mktemp -d) && npm init -y >/dev/null && npm i embedded-postgres pg
 *   node scripts/verify-migrations.js
 * Environment:
 *   PG_PORT (default 5544), PG_HOST (default 127.0.0.1), PG_USER (default postgres)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireOrFail(name) {
  // Resolved from the script first, then from the working directory (so the
  // dependencies can live in a scratch dir outside the repo).
  for (const base of [__dirname, process.cwd()]) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(require.resolve(name, { paths: [base] }));
    } catch {
      /* try next base */
    }
  }
  console.error(
    `Missing dependency "${name}". Run this in a scratch directory first:\n` +
      '  npm init -y >/dev/null && npm i embedded-postgres pg\n' +
      'then run: node <repo>/scripts/verify-migrations.js from that directory.',
  );
  process.exit(1);
}

const { Client } = requireOrFail('pg');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PG_PORT || 5544);
const HOST = process.env.PG_HOST || '127.0.0.1';
const USER = process.env.PG_USER || 'postgres';

async function startEmbeddedPostgres() {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pgval-'));
  fs.chmodSync(dataDir, 0o700);
  // Locate the package root, then its platform binaries: the npm distribution
  // keeps them in an optional dependency @embedded-postgres/<platform>.
  const entry = require.resolve('embedded-postgres', { paths: [__dirname, process.cwd()] });
  let pkgDir = path.dirname(entry);
  for (let i = 0; i < 6 && !fs.existsSync(path.join(pkgDir, 'package.json')); i += 1)
    pkgDir = path.dirname(pkgDir);
  const nmDir = path.dirname(pkgDir);
  const platform = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(nmDir, '@embedded-postgres', platform, 'native', 'bin'),
    path.join(pkgDir, 'native', 'bin'),
  ];
  const native = candidates.find((dir) => fs.existsSync(path.join(dir, 'postgres')));
  if (!native) throw new Error('embedded-postgres binaries not found for ' + platform);
  execFileSync(path.join(native, 'initdb'), ['-D', dataDir, '-U', USER, '--auth=trust'], {
    stdio: 'ignore',
  });
  execFileSync(path.join(native, 'pg_ctl'), [
    '-D',
    dataDir,
    '-o',
    `-p ${PORT} -k ${os.tmpdir()} -c listen_addresses=${HOST}`,
    '-l',
    path.join(dataDir, 'postgres.log'),
    'start',
  ]);
  return async () => {
    try {
      execFileSync(path.join(native, 'pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast'], {
        stdio: 'ignore',
      });
    } catch {
      /* best effort */
    }
  };
}

async function main() {
  const stop = await startEmbeddedPostgres();
  let db;
  try {
    const admin = new Client({ host: HOST, port: PORT, user: USER, database: 'postgres' });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS sv_migration_val');
    await admin.query('CREATE DATABASE sv_migration_val');
    await admin.end();

    db = new Client({ host: HOST, port: PORT, user: USER, database: 'sv_migration_val' });
    await db.connect();

    const migrationsDir = path.join(ROOT, 'apps', 'api', 'prisma', 'migrations');
    const dirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
      .sort();
    for (const dir of dirs) {
      const sql = fs.readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
      try {
        await db.query(sql);
        console.log(`applied ${dir}`);
      } catch (error) {
        console.error(`FAILED ${dir}: ${error.message}`);
        process.exitCode = 1;
        return;
      }
    }

    // --- expected schema, parsed from schema.prisma ---
    const schema = fs.readFileSync(
      path.join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const SCALARS = new Set([
      'String',
      'Int',
      'Float',
      'Decimal',
      'Boolean',
      'DateTime',
      'Json',
      'Bytes',
      'BigInt',
    ]);
    const modelBlocks = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
    const problems = [];
    let fieldsChecked = 0;
    for (const [, modelName, body] of modelBlocks) {
      const tableMap = body.match(/@@map\("([^"]+)"\)/);
      const table = tableMap ? tableMap[1] : modelName;
      const expected = new Map();
      for (const line of body.split('\n')) {
        const field = line.match(/^\s{2}(\w+)\s+(\w+)(\[\])?(\?)?(\s|\{|$)/);
        if (!field) continue;
        const [, name, type, isArray, opt] = field;
        // Relation fields (single or list) are not columns.
        if (type === 'relation' || /@relation\(/.test(line)) continue;
        if (isArray && !SCALARS.has(type)) continue;
        const explicitMap = line.match(/ @map\("([^"]+)"\)/);
        const column = explicitMap ? explicitMap[1] : name;
        expected.set(column, {
          optional: Boolean(opt) || /@default/.test(line) || Boolean(isArray),
          field: name,
        });
      }
      const cols = await db.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1`,
        [table],
      );
      if (cols.rows.length === 0) {
        problems.push(`${modelName}: table "${table}" missing after migrations`);
        continue;
      }
      const actual = new Map(cols.rows.map((row) => [row.column_name, row.is_nullable === 'YES']));
      for (const [column, meta] of expected) {
        fieldsChecked += 1;
        if (!actual.has(column))
          problems.push(
            `${modelName}.${meta.field}: column "${column}" MISSING in table "${table}"`,
          );
        else if (!meta.optional && actual.get(column) === true)
          problems.push(
            `${modelName}.${meta.field}: column "${column}" is NULLABLE in DB but required in schema`,
          );
      }
      for (const column of actual.keys())
        if (!expected.has(column))
          problems.push(`table "${table}": extra column "${column}" not in schema`);
    }
    console.log(`\nmodels checked: ${modelBlocks.length}, columns checked: ${fieldsChecked}`);
    if (problems.length) {
      console.error(`\nSCHEMA MISMATCHES (${problems.length}):`);
      for (const p of problems) console.error('  - ' + p);
      process.exitCode = 1;
    } else {
      console.log('schema matches migrations for every model ✔');
    }
  } finally {
    if (db) await db.end().catch(() => undefined);
    await stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
