// @vitest-environment node
/**
 * GET /api/v1/openapi.json — public OpenAPI 3.1 document.
 *
 * The document is hand-maintained (src/lib/api/openapi.ts); the drift test
 * here asserts every route file under src/app/api/v1/** has a corresponding
 * path entry, so a new v1 route cannot ship undocumented. /api/v1/metrics
 * and /api/v1/openapi.json are exempt from the requirement (self-describing
 * discovery endpoints) but are documented anyway.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { GET } from './route';
import { OPENAPI_DOCUMENT } from '@/lib/api/openapi';

const V1_DIR = path.join(process.cwd(), 'src', 'app', 'api', 'v1');
const DRIFT_EXEMPT = new Set(['/api/v1/metrics', '/api/v1/openapi.json']);

/** All /api/v1 paths that have a route.ts on disk. Dynamic segments use
    OpenAPI style: the `[id]` directory documents as `{id}`. */
function routePathsOnDisk(): string[] {
  const paths: string[] = [];
  const walk = (dir: string, urlPath: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const segment = entry.name.replace(/^\[(.+)\]$/, '{$1}');
        walk(path.join(dir, entry.name), `${urlPath}/${segment}`);
      } else if (entry.name === 'route.ts') {
        paths.push(urlPath);
      }
    }
  };
  walk(V1_DIR, '/api/v1');
  return paths;
}

describe('GET /api/v1/openapi.json', () => {
  it('serves the OpenAPI 3.1 document publicly with CORS', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('HealthTrack API');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('documents the bearer security scheme with every scope', () => {
    const scheme = OPENAPI_DOCUMENT.components.securitySchemes.bearerAuth;
    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');
    for (const scope of [
      'read:all',
      'write:all',
      'read:vitals',
      'write:vitals',
      'read:fitness',
      'write:fitness',
    ]) {
      expect(scheme.description).toContain(scope);
    }
  });

  it('describes the fitness surface (workouts 409 contract, week rollup, goals)', () => {
    const paths = OPENAPI_DOCUMENT.paths;
    expect(
      paths['/api/v1/workouts'].post.requestBody.content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/WorkoutWrite');
    expect(paths['/api/v1/workouts'].post.responses['409']).toBeDefined();
    expect(paths['/api/v1/workouts/{id}'].patch).toBeDefined();
    expect(paths['/api/v1/workouts/{id}'].delete).toBeDefined();
    expect(paths['/api/v1/exercises/{id}/history'].get).toBeDefined();
    expect(paths['/api/v1/checkins/{weekStart}'].put).toBeDefined();
    expect(paths['/api/v1/weeks/{weekStart}'].get.responses['200']).toBeDefined();
    expect(paths['/api/v1/goals'].post.responses['409']).toBeDefined();
    expect(paths['/api/v1/vitals/latest'].get).toBeDefined();
    const schemas = OPENAPI_DOCUMENT.components.schemas;
    for (const name of ['Workout', 'WorkoutWrite', 'Exercise', 'Checkin', 'Goal', 'WeekRollup']) {
      expect(schemas[name as keyof typeof schemas], `missing schema: ${name}`).toBeDefined();
    }
  });

  it('describes the vitals write surface (request/response/batch schemas)', () => {
    const paths = OPENAPI_DOCUMENT.paths;
    expect(paths['/api/v1/vitals'].post.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/VitalWrite',
    );
    expect(paths['/api/v1/vitals/batch'].post).toBeDefined();
    const schemas = OPENAPI_DOCUMENT.components.schemas;
    expect(schemas.VitalWrite.required).toEqual(['metric_key', 'recorded_at', 'source']);
    expect(schemas.BatchEnvelope.properties.records.maxItems).toBe(500);
    expect(schemas.BatchResult.required).toEqual(['inserted', 'updated', 'errors']);
    expect(schemas.Error).toBeDefined();
  });

  it('has a path entry for every v1 route file on disk (drift pin)', () => {
    const documented = new Set(Object.keys(OPENAPI_DOCUMENT.paths));
    const onDisk = routePathsOnDisk();
    expect(onDisk.length).toBeGreaterThanOrEqual(12);
    for (const routePath of onDisk) {
      if (DRIFT_EXEMPT.has(routePath)) continue;
      expect(documented, `undocumented v1 route: ${routePath}`).toContain(routePath);
    }
  });

  it('marks the discovery endpoints as auth-free', () => {
    expect(OPENAPI_DOCUMENT.paths['/api/v1/metrics'].get.security).toEqual([]);
    expect(OPENAPI_DOCUMENT.paths['/api/v1/openapi.json'].get.security).toEqual([]);
    // Everything else inherits the root bearerAuth requirement.
    expect(OPENAPI_DOCUMENT.security).toEqual([{ bearerAuth: [] }]);
  });
});
