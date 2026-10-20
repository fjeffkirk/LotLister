import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { TiktokUserError, redactSecrets } from './policy';

export function tiktokJson(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function tiktokError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ success: false, error: 'Check the form and try again.' }, { status: 400 });
  }
  if (error instanceof TiktokUserError) {
    const status = error.code === 'not_configured' ? 503 : 400;
    return NextResponse.json({ success: false, code: error.code, error: error.message }, { status });
  }
  return NextResponse.json({ success: false, error: 'TikTok request failed.' }, { status: 500 });
}

export function publicError(error: unknown): string {
  const message = error instanceof TiktokUserError ? error.message : 'TikTok connection failed. Start again from LotLister.';
  return redactSecrets(message).slice(0, 180);
}
