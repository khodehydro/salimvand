import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression net for the outage of 2026-10-04: a new module registered a
 * controller guarded by JwtAuthGuard without importing AuthModule, so the
 * API could not boot (Nest DI: «AuthService is available in the …Module
 * context»). Unit tests build no Nest DI graph, so the failure only
 * surfaced at deploy time. This test statically walks every module file
 * and asserts the rule that Nest enforces at runtime.
 */

const SRC_ROOT = join(__dirname);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** CamelCase → kebab-case (CatalogAdminController → catalog-admin). */
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Source-file path of a controller class, following the repo convention
 * CatalogAdminController → catalog-admin.controller.ts. */
function controllerFile(files: string[], controller: string): string | undefined {
  const base = controller.endsWith('Controller')
    ? kebab(controller.slice(0, -'Controller'.length))
    : kebab(controller);
  const suffix = `/${base}.controller.ts`;
  return files.find((file) => file.endsWith(suffix));
}

/** Extracts the identifiers listed inside a Nest module property array. */
function arrayIdentifiers(source: string, property: string): string[] {
  const match = source.match(new RegExp(`${property}\\s*:\\s*\\[([^\\]]*)\\]`, 's'));
  if (!match) return [];
  return [...match[1].matchAll(/([A-Za-z0-9_]+)/g)].map((item) => item[1]);
}

describe('module guard wiring', () => {
  it('every module with JwtAuthGuard-guarded controllers imports AuthModule', () => {
    const files = walk(SRC_ROOT).filter((file) => file.endsWith('.ts'));
    const moduleFiles = files.filter((file) => file.endsWith('.module.ts'));
    expect(moduleFiles.length).toBeGreaterThan(5);

    const problems: string[] = [];
    for (const moduleFile of moduleFiles) {
      // AuthModule itself hosts the guard and its dependency — nothing to import.
      if (moduleFile.endsWith('/auth/auth.module.ts')) continue;
      const source = readFileSync(moduleFile, 'utf8');
      const controllers = arrayIdentifiers(source, 'controllers');
      if (!controllers.length) continue;

      // The module needs AuthModule when any of its controller files uses
      // the auth guard (JwtAuthGuard injects AuthService).
      const guardedControllers = controllers.filter((controller) => {
        const file = controllerFile(files, controller);
        return file !== undefined && readFileSync(file, 'utf8').includes('JwtAuthGuard');
      });
      if (!guardedControllers.length) continue;

      const importsAuth = arrayIdentifiers(source, 'imports').includes('AuthModule');
      if (!importsAuth)
        problems.push(
          `${moduleFile.replace(`${SRC_ROOT}/`, '')} → guarded controllers: ${guardedControllers.join(', ')}`,
        );
    }

    expect(problems).toEqual([]);
  });
});
