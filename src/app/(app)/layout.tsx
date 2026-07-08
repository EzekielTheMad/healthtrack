'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import BottomNav from '@/components/shared/BottomNav';
import SidebarNav from '@/components/shared/SidebarNav';
import { AutoLogout } from '@/components/shared/AutoLogout';
import { DateRangeProvider } from '@/components/shared/DateRangeContext';
import { OfflineIndicator } from '@/components/shared/OfflineIndicator';
import { ActiveProfileProvider } from '@/components/shared/ActiveProfileProvider';
import ProfileSwitcher from '@/components/shared/ProfileSwitcher';
import { registerServiceWorker } from '@/lib/offline/register-sw';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <DateRangeProvider>
      <ActiveProfileProvider>
        <div className="flex min-h-screen">
          <AutoLogout timeoutMinutes={15} />
          <OfflineIndicator />
          {/* Desktop sidebar */}
          <div className="hidden md:block">
            <SidebarNav activePath={pathname} />
          </div>
          {/* Main content */}
          <main
            id="main-content"
            className="flex-1 pb-20 md:pb-0 md:ml-64 min-h-screen"
          >
            <div className="max-w-[1000px] mx-auto px-4 py-6 xl:px-0">
              <div className="flex justify-end mb-4">
                <ProfileSwitcher />
              </div>
              {children}
            </div>
          </main>
          {/* Mobile bottom nav */}
          <div className="md:hidden">
            <BottomNav activePath={pathname} />
          </div>
        </div>
      </ActiveProfileProvider>
    </DateRangeProvider>
  );
}
