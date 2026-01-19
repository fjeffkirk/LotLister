'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import Link from 'next/link';

// File with its pre-created object URL
interface FileWithUrl {
  file: File;
  url: string;
  id: string;
}

// Memoized image component
const DraggableImage = memo(function DraggableImage({
  fileData,
  index,
  cardNumber,
  positionInCard,
  isFirstInCard,
  isFirst,
  isLast,
  onRemove,
  onMoveLeft,
  onMoveRight,
  dragHandlers,
}: {
  fileData: FileWithUrl;
  index: number;
  cardNumber: number;
  positionInCard: number;
  isFirstInCard: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  dragHandlers: {
    onDragStart: (e: React.DragEvent, index: number) => void;
    onDragEnd: (e: React.DragEvent) => void;
    onDragEnter: (e: React.DragEvent, index: number) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent, index: number) => void;
  };
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  
  return (
    <div
      draggable
      data-index={index}
      onDragStart={(e) => dragHandlers.onDragStart(e, index)}
      onDragEnd={dragHandlers.onDragEnd}
      onDragEnter={(e) => dragHandlers.onDragEnter(e, index)}
      onDragOver={dragHandlers.onDragOver}
      onDrop={(e) => dragHandlers.onDrop(e, index)}
      className={`
        draggable-image relative aspect-square rounded-lg overflow-hidden bg-surface-800 
        group cursor-grab active:cursor-grabbing select-none
        ${isFirstInCard ? 'ring-2 ring-green-500/70' : ''}
      `}
    >
      {/* Loading spinner */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-800 z-10">
          <div className="w-6 h-6 border-2 border-surface-600 border-t-primary-500 rounded-full animate-spin"></div>
        </div>
      )}
      
      <img
        src={fileData.url}
        alt={fileData.file.name}
        className={`w-full h-full object-cover pointer-events-none ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        draggable={false}
        onLoad={() => setIsLoaded(true)}
      />
      
      {/* Card indicator */}
      <div className={`absolute top-0 left-0 right-0 px-1.5 py-1 text-[10px] font-semibold pointer-events-none ${
        isFirstInCard ? 'bg-green-600/90 text-white' : 'bg-black/70 text-surface-200'
      }`}>
        C{cardNumber} {isFirstInCard ? '• Front' : `• #${positionInCard}`}
      </div>
      
      {/* Index badge */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/80 px-1.5 py-1 text-xs text-white flex items-center justify-between">
        <span className="font-medium pointer-events-none">{index + 1}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); onMoveLeft(); }}
            disabled={isFirst}
            className="w-5 h-5 flex items-center justify-center hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            type="button"
          >
            ←
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveRight(); }}
            disabled={isLast}
            className="w-5 h-5 flex items-center justify-center hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
            type="button"
          >
            →
          </button>
        </div>
      </div>
      
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0 right-0 w-6 h-6 bg-red-600 flex items-center justify-center opacity-0 group-hover:opacity-100"
        type="button"
      >
        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.fileData.id === nextProps.fileData.id &&
    prevProps.index === nextProps.index &&
    prevProps.cardNumber === nextProps.cardNumber &&
    prevProps.positionInCard === nextProps.positionInCard &&
    prevProps.isFirstInCard === nextProps.isFirstInCard &&
    prevProps.isFirst === nextProps.isFirst &&
    prevProps.isLast === nextProps.isLast
  );
});

export default function ImportPage() {
  const params = useParams();
  const lotId = params.lotId as string;
  const router = useRouter();
  
  // Store files with their pre-created URLs
  const [filesWithUrls, setFilesWithUrls] = useState<FileWithUrl[]>([]);
  const [imagesPerCard, setImagesPerCard] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs for drag state
  const draggedIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const currentDragTargetRef = useRef<HTMLElement | null>(null);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      filesWithUrls.forEach(f => URL.revokeObjectURL(f.url));
    };
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const imageFiles = acceptedFiles
      .filter((file) => file.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    
    // Create URLs immediately for all new files
    const newFilesWithUrls: FileWithUrl[] = imageFiles.map(file => ({
      file,
      url: URL.createObjectURL(file),
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
    }));
    
    setFilesWithUrls(prev => [...prev, ...newFilesWithUrls]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp'],
    },
    multiple: true,
  });

  const removeFile = useCallback((index: number) => {
    setFilesWithUrls(prev => {
      const fileData = prev[index];
      if (fileData) URL.revokeObjectURL(fileData.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearFiles = useCallback(() => {
    filesWithUrls.forEach(f => URL.revokeObjectURL(f.url));
    setFilesWithUrls([]);
  }, [filesWithUrls]);

  const moveImage = useCallback((fromIndex: number, direction: 'left' | 'right') => {
    const toIndex = direction === 'left' ? fromIndex - 1 : fromIndex + 1;
    setFilesWithUrls(prev => {
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const newFiles = [...prev];
      [newFiles[fromIndex], newFiles[toIndex]] = [newFiles[toIndex], newFiles[fromIndex]];
      return newFiles;
    });
  }, []);

  // Drag handlers
  const dragHandlers = useRef({
    onDragStart: (e: React.DragEvent, index: number) => {
      draggedIndexRef.current = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      requestAnimationFrame(() => {
        (e.target as HTMLElement).classList.add('opacity-40', 'scale-95');
      });
    },
    
    onDragEnd: (e: React.DragEvent) => {
      (e.target as HTMLElement).classList.remove('opacity-40', 'scale-95');
      if (currentDragTargetRef.current) {
        currentDragTargetRef.current.classList.remove('ring-2', 'ring-primary-400', 'scale-105');
        currentDragTargetRef.current = null;
      }
      draggedIndexRef.current = null;
      dragOverIndexRef.current = null;
    },
    
    onDragEnter: (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndexRef.current === null || draggedIndexRef.current === index) return;
      if (currentDragTargetRef.current) {
        currentDragTargetRef.current.classList.remove('ring-2', 'ring-primary-400', 'scale-105');
      }
      const target = e.currentTarget as HTMLElement;
      target.classList.add('ring-2', 'ring-primary-400', 'scale-105');
      currentDragTargetRef.current = target;
      dragOverIndexRef.current = index;
    },
    
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    
    onDrop: (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (currentDragTargetRef.current) {
        currentDragTargetRef.current.classList.remove('ring-2', 'ring-primary-400', 'scale-105');
        currentDragTargetRef.current = null;
      }
      const dragIndex = draggedIndexRef.current;
      if (dragIndex === null || dragIndex === dropIndex) {
        draggedIndexRef.current = null;
        dragOverIndexRef.current = null;
        return;
      }
      setFilesWithUrls(prev => {
        const newFiles = [...prev];
        const [draggedFile] = newFiles.splice(dragIndex, 1);
        newFiles.splice(dropIndex, 0, draggedFile);
        return newFiles;
      });
      draggedIndexRef.current = null;
      dragOverIndexRef.current = null;
    },
  }).current;

  const handleUpload = async () => {
    if (filesWithUrls.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('imagesPerCard', String(imagesPerCard));
      filesWithUrls.forEach(({ file }) => {
        formData.append('images', file);
      });

      const res = await fetch(`/api/lots/${lotId}/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        router.push(`/lots/${lotId}`);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const cardsToCreate = Math.ceil(filesWithUrls.length / imagesPerCard);

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Header */}
      <header className="border-b border-surface-800 bg-surface-950/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/lots/${lotId}`} className="btn-ghost p-2 rounded-lg">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-semibold">Import Photos</h1>
          </div>
          
          {filesWithUrls.length > 0 && (
            <div className="flex items-center gap-3">
              <Link href={`/lots/${lotId}`} className="btn btn-secondary text-sm py-2">
                Cancel
              </Link>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="btn btn-primary text-sm py-2"
              >
                {uploading ? (
                  <>
                    <div className="spinner"></div>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import {filesWithUrls.length} Images
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-4 text-red-400 hover:text-red-300">✕</button>
          </div>
        )}

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`dropzone cursor-pointer mb-6 ${isDragActive ? 'active' : ''} ${filesWithUrls.length > 0 ? 'py-4' : 'py-8'}`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-3">
            {filesWithUrls.length === 0 && (
              <div className="w-16 h-16 bg-surface-800 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            <div className="text-center">
              <p className={`font-medium text-surface-200 ${filesWithUrls.length > 0 ? 'text-sm' : 'text-lg'}`}>
                {isDragActive ? 'Drop images here' : filesWithUrls.length > 0 ? 'Drop more images or click to add' : 'Drag & drop images here'}
              </p>
              {filesWithUrls.length === 0 && (
                <p className="text-sm text-surface-400 mt-1">or click to select files</p>
              )}
            </div>
            {filesWithUrls.length === 0 && (
              <p className="text-xs text-surface-500">Supports: JPEG, PNG, GIF, WebP</p>
            )}
          </div>
        </div>

        {/* Settings bar */}
        {filesWithUrls.length > 0 && (
          <div className="panel p-4 mb-6">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-surface-300">Images per card:</label>
                <select
                  value={imagesPerCard}
                  onChange={(e) => setImagesPerCard(Number(e.target.value))}
                  className="w-32"
                >
                  <option value={1}>1</option>
                  <option value={2}>2 (front/back)</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>
              <div className="h-6 w-px bg-surface-700" />
              <span className="text-sm text-surface-300">
                <span className="font-semibold text-surface-100">{filesWithUrls.length}</span> images → <span className="font-semibold text-primary-400">{cardsToCreate}</span> cards
              </span>
              <div className="ml-auto flex items-center gap-2 text-xs text-surface-400">
                <span className="inline-block w-3 h-3 bg-green-600 rounded"></span>
                <span>= Front of card</span>
              </div>
            </div>
          </div>
        )}

        {/* Selected Images Grid */}
        {filesWithUrls.length > 0 && (
          <div className="panel">
            <div className="p-4 border-b border-surface-700 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-lg">Selected Images ({filesWithUrls.length})</h3>
                <p className="text-sm text-surface-400 mt-0.5">
                  <span className="text-primary-400">Drag and drop</span> to reorder • First image in each pair = front of card
                </p>
              </div>
              <button
                onClick={clearFiles}
                className="text-sm text-surface-400 hover:text-red-400 transition-colors"
                type="button"
              >
                Clear all
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-3">
                {filesWithUrls.map((fileData, index) => {
                  const cardNumber = Math.floor(index / imagesPerCard) + 1;
                  const positionInCard = (index % imagesPerCard) + 1;
                  const isFirstInCard = positionInCard === 1;
                  
                  return (
                    <DraggableImage
                      key={fileData.id}
                      fileData={fileData}
                      index={index}
                      cardNumber={cardNumber}
                      positionInCard={positionInCard}
                      isFirstInCard={isFirstInCard}
                      isFirst={index === 0}
                      isLast={index === filesWithUrls.length - 1}
                      onRemove={() => removeFile(index)}
                      onMoveLeft={() => moveImage(index, 'left')}
                      onMoveRight={() => moveImage(index, 'right')}
                      dragHandlers={dragHandlers}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {filesWithUrls.length === 0 && (
          <div className="flex justify-center gap-3 mt-8">
            <Link href={`/lots/${lotId}`} className="btn btn-secondary">Cancel</Link>
          </div>
        )}
      </main>
    </div>
  );
}
