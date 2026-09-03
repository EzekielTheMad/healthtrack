/**
 * Next.js server-boot hook. Database migrations and the Oura scheduler are
 * both best-effort so an unavailable integration never prevents app startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { runMigrations } = await import('@/db/migrate');
    runMigrations();
  } catch (error) { console.error('[startup] database migration failed:', error); }
  try {
    const { registerOuraScheduler } = await import('@/lib/oura/scheduler');
    registerOuraScheduler();
  } catch (error) { console.error('[startup] Oura scheduler registration failed:', error); }
}
