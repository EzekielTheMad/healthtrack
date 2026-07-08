export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border-card bg-bg-card p-8 shadow-[var(--shadow-lifted)]">
        {children}
      </div>
    </div>
  );
}
