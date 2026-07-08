/**
 * Route-handler builders for the clinical CRUD domains (providers,
 * medications, conditions, allergies, procedures, vaccines). Each domain's
 * route file stays a thin wrapper; scoping conventions mirror the hooks:
 *
 *   GET  ?owner_id=<id>        delegate mode → that owner, no dependent filter
 *        ?dependent_id=<id>    otherwise exact dependent (or self when absent)
 *   POST { owner_id?, dependent_id?, ...fields }
 *   PATCH/DELETE /<id>         row scope derived from the row in the repo
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel, rowToSnake, rowsToSnake } from '@/lib/api/snake';
import {
  createScopeFromBody,
  scopeFromParams,
  type ListScope,
} from '@/lib/repos/_scope';

interface CollectionConfig<Row extends object> {
  list(actorId: string, scope: ListScope, searchParams: URLSearchParams): Promise<Row[]>;
  create(
    actorId: string,
    scope: { ownerId: string; dependentId: string | null },
    input: Record<string, unknown>,
  ): Promise<Row>;
}

export function collectionHandlers<Row extends object>(cfg: CollectionConfig<Row>) {
  async function GET(request: NextRequest) {
    try {
      const user = await requireUser();
      const params = request.nextUrl.searchParams;
      const rows = await cfg.list(user.id, scopeFromParams(user.id, params), params);
      return NextResponse.json(rowsToSnake(rows));
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function POST(request: NextRequest) {
    try {
      const user = await requireUser();
      const body = bodyToCamel(await request.json());
      const scope = createScopeFromBody(user.id, body);
      const row = await cfg.create(user.id, scope, body);
      return NextResponse.json(rowToSnake(row), { status: 201 });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { GET, POST };
}

type ItemRouteContext = { params: Promise<{ id: string }> };

interface ItemConfig<Row extends object> {
  update(actorId: string, id: string, updates: Record<string, unknown>): Promise<Row>;
  remove?(actorId: string, id: string): Promise<void>;
}

export function itemHandlers<Row extends object>(cfg: ItemConfig<Row>) {
  async function PATCH(request: NextRequest, context: ItemRouteContext) {
    try {
      const user = await requireUser();
      const { id } = await context.params;
      const updates = bodyToCamel(await request.json());
      const row = await cfg.update(user.id, id, updates);
      return NextResponse.json(rowToSnake(row));
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function DELETE(_request: NextRequest, context: ItemRouteContext) {
    try {
      if (!cfg.remove) {
        return NextResponse.json(
          { error: 'method_not_allowed', message: 'Delete not supported', status: 405 },
          { status: 405 },
        );
      }
      const user = await requireUser();
      const { id } = await context.params;
      await cfg.remove(user.id, id);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { PATCH, DELETE };
}
