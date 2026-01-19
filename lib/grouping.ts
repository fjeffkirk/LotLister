/**
 * Image grouping algorithm for creating CardItems from uploaded images
 */

import { CardImage } from '@prisma/client';
import prisma from './prisma';
import { v4 as uuidv4 } from 'uuid';

export interface ImageInfo {
  id: string;
  originalPath: string;
  thumbPath: string;
  filename: string;
  sortOrder: number;
}

export interface CardGroup {
  cardItemId: string;
  images: ImageInfo[];
}

/**
 * Sort images by filename (natural sort), then by upload order
 */
function sortImages(images: ImageInfo[]): ImageInfo[] {
  return [...images].sort((a, b) => {
    // Natural sort by filename
    return a.filename.localeCompare(b.filename, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

/**
 * Group images into card groups based on images per card setting
 */
export function groupImages(images: ImageInfo[], imagesPerCard: number): CardGroup[] {
  const sortedImages = sortImages(images);
  const groups: CardGroup[] = [];
  
  for (let i = 0; i < sortedImages.length; i += imagesPerCard) {
    const groupImages = sortedImages.slice(i, i + imagesPerCard);
    groups.push({
      cardItemId: uuidv4(),
      images: groupImages.map((img, idx) => ({
        ...img,
        sortOrder: idx,
      })),
    });
  }
  
  return groups;
}

/**
 * Create CardItems from grouped images
 */
export async function createCardItemsFromGroups(
  lotId: string,
  groups: CardGroup[]
): Promise<void> {
  // Use a transaction to ensure all items are created together
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      
      // Create the CardItem
      const cardItem = await tx.cardItem.create({
        data: {
          id: group.cardItemId,
          lotId,
          sortOrder: i,
        },
      });
      
      // Create CardImage records
      for (const img of group.images) {
        await tx.cardImage.create({
          data: {
            cardItemId: cardItem.id,
            originalPath: img.originalPath,
            thumbPath: img.thumbPath,
            filename: img.filename,
            sortOrder: img.sortOrder,
          },
        });
      }
    }
  });
}

/**
 * Regroup existing images for a lot with new images per card setting
 */
export async function regroupLotImages(
  lotId: string,
  imagesPerCard: number
): Promise<void> {
  // Get all current images for the lot
  const cardItems = await prisma.cardItem.findMany({
    where: { lotId },
    include: { images: true },
    orderBy: { sortOrder: 'asc' },
  });
  
  // Flatten all images
  const allImages: ImageInfo[] = cardItems
    .flatMap((item) =>
      item.images.map((img) => ({
        id: img.id,
        originalPath: img.originalPath,
        thumbPath: img.thumbPath,
        filename: img.filename,
        sortOrder: img.sortOrder,
      }))
    );
  
  if (allImages.length === 0) return;
  
  // Create new groupings
  const newGroups = groupImages(allImages, imagesPerCard);
  
  // Delete old CardItems (cascade will delete images)
  await prisma.cardItem.deleteMany({
    where: { lotId },
  });
  
  // Create new CardItems with regrouped images
  await createCardItemsFromGroups(lotId, newGroups);
}

/**
 * Move an image from one card to another
 */
export async function moveImageToCard(
  imageId: string,
  targetCardItemId: string,
  newSortOrder: number
): Promise<void> {
  await prisma.cardImage.update({
    where: { id: imageId },
    data: {
      cardItemId: targetCardItemId,
      sortOrder: newSortOrder,
    },
  });
}

/**
 * Reorder images within a card
 */
export async function reorderImagesInCard(
  cardItemId: string,
  imageIds: string[]
): Promise<void> {
  await prisma.$transaction(
    imageIds.map((id, index) =>
      prisma.cardImage.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
}
