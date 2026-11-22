"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { businessFetch, ensureBusinessDeviceCode, getBusinessApiBase } from '../lib/business-deny-client';

export default function BusinessRiskGate() {
  const pathname = usePathname();

  useEffect(() => {
    ensureBusinessDeviceCode();
    let checking = false;
    let disposed = false;

    const check = async () => {
      if (checking || disposed || document.visibilityState === 'hidden') return;
      checking = true;
      const headers: Record<string, string> = {};
      // /mg uses its own in-memory authenticated session. Its API requests
      // send their own bearer token; never substitute a home-page account.
      if (!/^\/(?:pan\/)?mg(?:\/|$)/.test(pathname || '')) {
        try {
          const token = window.localStorage.getItem('BDPAN_TOKEN');
          if (token) headers.Authorization = `Bearer ${token}`;
        } catch {}
      }
      try {
        await businessFetch(`${getBusinessApiBase()}/api/check-risk`, { headers, cache: 'no-store' });
      } catch {} finally { checking = false; }
    };

    // The home page already performs a check to display the risk warning.
    // All other routes (including /mg and not-found) check on entry as well.
    if (pathname !== '/' && pathname !== '/pan' && pathname !== '/pan/') void check();
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    return () => {
      disposed = true;
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, [pathname]);

  return null;
}
