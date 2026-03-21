import { NextResponse } from 'next/server';
import { getSettings } from '../../../lib/users';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settings = await getSettings();
    // Expose only public safe settings
    return NextResponse.json({
      disableThirdDownload: settings.disableThirdDownload === true,
      enableGuestMode: settings.enableGuestMode,
      downloadChannel: settings.downloadChannel || 'ecs',
      hideAlistButton: settings.hideAlistButton === true,
      downloadModes: settings.downloadModes || {
        ecs: 'enabled', cf: 'enabled', raw: 'enabled', vercel: 'disabled', direct302: 'enabled'
      }
    });
  } catch (error: any) {
    return NextResponse.json({ disableThirdDownload: false }, { status: 500 });
  }
}
