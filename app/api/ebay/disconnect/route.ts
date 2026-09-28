import { NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import prisma from '../../../../lib/prisma';

export async function POST() {
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.json({ success: false, error: 'User email not set' }, { status: 401 });
  }

  await prisma.ebayConnection.deleteMany({ where: { userEmail } });
  return NextResponse.json({ success: true });
}
