import { NextResponse } from 'next/server';
import { getSettings } from '../../../lib/users';

export async function GET() {
  try {
    const settings = await getSettings();
    // Expose only public safe settings
    return NextResponse.json({
      disableThirdDownload: settings.disableThirdDownload === true,
      enableGuestMode: settings.enableGuestMode
    });
  } catch (error: any) {
    return NextResponse.json({ disableThirdDownload: false }, { status: 500 });
  }
}
