import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserEmail } from '../../../lib/auth';

interface UserStats {
  email: string;
  completedCount: number;
}

// GET /api/user - Get current user stats
export async function GET(): Promise<NextResponse<{ success: boolean; data?: UserStats; error?: string }>> {
  try {
    const userEmail = await getUserEmail();
    
    if (!userEmail) {
      return NextResponse.json(
        { success: false, error: 'User email not set' },
        { status: 401 }
      );
    }

    // Get or create user record
    const user = await prisma.user.upsert({
      where: { email: userEmail },
      update: {},
      create: { email: userEmail, completedCount: 0 },
    });

    return NextResponse.json({
      success: true,
      data: {
        email: user.email,
        completedCount: user.completedCount,
      },
    });
  } catch (error) {
    console.error('Failed to get user stats:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get user stats' },
      { status: 500 }
    );
  }
}
