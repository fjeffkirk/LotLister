import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const UPLOADS_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads');
const MAX_STORAGE_GB = 1; // Match render.yaml disk size

interface StorageInfo {
  usedBytes: number;
  usedMB: number;
  usedGB: number;
  maxGB: number;
  percentUsed: number;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // Directory might not exist yet
    return 0;
  }
  
  return totalSize;
}

// GET /api/storage - Get storage usage info
export async function GET(): Promise<NextResponse<{ success: boolean; data?: StorageInfo; error?: string }>> {
  try {
    const usedBytes = await getDirectorySize(UPLOADS_DIR);
    const usedMB = Math.round((usedBytes / (1024 * 1024)) * 100) / 100;
    const usedGB = Math.round((usedBytes / (1024 * 1024 * 1024)) * 1000) / 1000;
    const percentUsed = Math.round((usedGB / MAX_STORAGE_GB) * 100);
    
    return NextResponse.json({
      success: true,
      data: {
        usedBytes,
        usedMB,
        usedGB,
        maxGB: MAX_STORAGE_GB,
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
