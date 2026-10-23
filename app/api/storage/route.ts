import { NextResponse } from 'next/server';
import { storageCapacity } from '../../../lib/storage-capacity';

export const dynamic = 'force-dynamic';

interface StorageInfo {
  usedBytes: number;
  usedMB: number;
  usedGB: number;
  maxGB: number;
  percentUsed: number;
  freeBytes: number;
  totalBytes: number;
}

// GET /api/storage - Get storage usage info
export async function GET(): Promise<NextResponse<{ success: boolean; data?: StorageInfo; error?: string }>> {
  try {
    const { usedBytes, freeBytes, totalBytes } = await storageCapacity();
    const usedMB = Math.round((usedBytes / (1024 * 1024)) * 100) / 100;
    const usedGB = Math.round((usedBytes / (1024 * 1024 * 1024)) * 1000) / 1000;
    const maxGB = Math.round((totalBytes / (1024 ** 3)) * 100) / 100;
    const percentUsed = Math.round((usedBytes / totalBytes) * 100);
    
    return NextResponse.json({
      success: true,
      data: {
        usedBytes,
        usedMB,
        usedGB,
        maxGB,
        freeBytes,
        totalBytes,
        percentUsed: Math.min(percentUsed, 100),
      },
    });
  } catch (error) {
    console.error('Failed to get storage info:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get storage info' },
      { status: 500 }
    );
  }
}
