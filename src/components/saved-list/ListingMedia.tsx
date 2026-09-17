"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Map as MapIcon, X } from "lucide-react";
import type { InviteIdentity, ListingCandidate } from "@/lib/listings";
import { ListingInlineMap } from "./map/LeafletListingMap";

const inlinePhotoSizes = "(max-width: 900px) 100vw, 640px";
const modalPhotoSizes = "(max-width: 1180px) 100vw, 1180px";
const thumbnailPhotoSizes = "124px";

export type ListingMediaProps = {
  identity?: InviteIdentity | undefined;
  listing: ListingCandidate;
};

export function ListingMedia({ identity, listing }: ListingMediaProps) {
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [shownListingId, setShownListingId] = useState(listing.id);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);
  // Photos arrive from arbitrary scrapers, so dedupe before they become React keys.
  const photoUrls = Array.from(new Set(listing.photos.filter(Boolean)));
  const mediaItemCount = photoUrls.length + 1;
  const mapMediaIndex = 0;

  // Selecting another listing resets the carousel; adjusting during render keeps the
  // reset in the same commit as the new listing instead of flashing the stale photo.
  if (listing.id !== shownListingId) {
    setShownListingId(listing.id);
    setSelectedMediaIndex(0);
    setIsPhotoModalOpen(false);
  }

  const isMapSelected = selectedMediaIndex === mapMediaIndex;
  const selectedPhotoUrl = !isMapSelected
    ? (photoUrls[selectedMediaIndex - 1] ?? photoUrls[0])
    : undefined;
  const showPhotoControls = mediaItemCount > 1;
  const photoPositionLabel = `${selectedMediaIndex + 1} of ${mediaItemCount}`;
  const photoAltText = `${listing.title} photo ${selectedMediaIndex}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isPhotoModalOpen || !dialog) {
      return;
    }

    // jsdom has no modal dialog implementation; the markup still renders there.
    if (!dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }

    dialogCloseRef.current?.focus();
  }, [isPhotoModalOpen]);

  const selectPhoto = (index: number) => setSelectedMediaIndex(index);
  const handlePreviousPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === 0 ? mediaItemCount - 1 : currentIndex - 1,
    );
  };
  const handleNextPhoto = () => {
    setSelectedMediaIndex((currentIndex) =>
      currentIndex === mediaItemCount - 1 ? 0 : currentIndex + 1,
    );
  };

  /** Arrow keys step through the media whenever one of the carousel controls has focus. */
  const handleControlArrowKeys = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!showPhotoControls) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handlePreviousPhoto();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleNextPhoto();
    }
  };

  // The lightbox's platform wiring lives on the dialog element itself: a click that lands
  // on the dialog rather than a child is a backdrop click, and arrow keys step through the
  // media wherever focus sits inside the modal.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isPhotoModalOpen || !dialog) {
      return;
    }

    function handleBackdropClick(event: MouseEvent) {
      if (event.target === dialog) {
        setIsPhotoModalOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPhotoModalOpen(false);
        return;
      }

      if (mediaItemCount <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedMediaIndex((currentIndex) =>
          currentIndex === 0 ? mediaItemCount - 1 : currentIndex - 1,
        );
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedMediaIndex((currentIndex) =>
          currentIndex === mediaItemCount - 1 ? 0 : currentIndex + 1,
        );
      }
    }

    dialog.addEventListener("click", handleBackdropClick);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("click", handleBackdropClick);
      dialog.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPhotoModalOpen, mediaItemCount]);

  const listingMap = <ListingInlineMap identity={identity} listing={listing} />;
  const sharedFrameProps = {
    listingTitle: listing.title,
    positionLabel: photoPositionLabel,
    showNavigation: showPhotoControls,
    onPrevious: handlePreviousPhoto,
    onNext: handleNextPhoto,
    onArrowKeys: handleControlArrowKeys,
  };
  const sharedStripProps = {
    listingTitle: listing.title,
    photoUrls,
    selectedMediaIndex,
    isMapSelected,
    onSelectMap: () => setSelectedMediaIndex(mapMediaIndex),
    onSelectPhoto: selectPhoto,
    onArrowKeys: handleControlArrowKeys,
  };

  return (
    <>
      <section className="listing-photo-carousel" aria-label={`Media for ${listing.title}`}>
        <PhotoFrame {...sharedFrameProps}>
          {isMapSelected ? (
            listingMap
          ) : selectedPhotoUrl ? (
            <button
              type="button"
              className="listing-photo-open listing-photo-canvas"
              aria-label={`Enlarge photo ${selectedMediaIndex} of ${photoUrls.length} for ${listing.title}`}
              onClick={() => setIsPhotoModalOpen(true)}
              onKeyDown={handleControlArrowKeys}
            >
              <Image
                unoptimized
                fill
                sizes={inlinePhotoSizes}
                src={selectedPhotoUrl}
                alt={photoAltText}
              />
            </button>
          ) : null}
        </PhotoFrame>
        {showPhotoControls ? <MediaStrip {...sharedStripProps} /> : null}
      </section>

      {isPhotoModalOpen ? (
        <dialog
          ref={dialogRef}
          className="listing-photo-modal"
          aria-label={`Enlarged photos for ${listing.title}`}
          onCancel={() => setIsPhotoModalOpen(false)}
          onClose={() => setIsPhotoModalOpen(false)}
        >
          <section className="listing-photo-modal-panel" aria-label={`Photos for ${listing.title}`}>
            <div className="listing-photo-modal-header">
              <div>
                <p className="eyebrow">Photos</p>
                <h3>{listing.title}</h3>
              </div>
              <button
                ref={dialogCloseRef}
                type="button"
                className="listing-photo-modal-close"
                aria-label="Close enlarged photo carousel"
                onClick={() => setIsPhotoModalOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <PhotoFrame {...sharedFrameProps} className="listing-photo-modal-frame">
              {isMapSelected ? (
                listingMap
              ) : selectedPhotoUrl ? (
                <div className="listing-photo-canvas">
                  <Image
                    unoptimized
                    fill
                    sizes={modalPhotoSizes}
                    src={selectedPhotoUrl}
                    alt={photoAltText}
                  />
                </div>
              ) : null}
            </PhotoFrame>
            {showPhotoControls ? (
              <MediaStrip
                {...sharedStripProps}
                className="listing-photo-modal-media-strip"
                thumbnailsClassName="listing-photo-modal-thumbnails"
              />
            ) : null}
          </section>
        </dialog>
      ) : null}
    </>
  );
}

/** The photo (or map) currently on show, its position caption, and the arrow controls. */
function PhotoFrame({
  className,
  listingTitle,
  positionLabel,
  showNavigation,
  onPrevious,
  onNext,
  onArrowKeys,
  children,
}: {
  className?: string;
  listingTitle: string;
  positionLabel: string;
  showNavigation: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onArrowKeys: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <figure className={joinClassNames("listing-photo-frame", className)}>
      {children}
      <figcaption className="listing-photo-count">{positionLabel}</figcaption>
      {showNavigation ? (
        <PhotoNavigation
          listingTitle={listingTitle}
          onPrevious={onPrevious}
          onNext={onNext}
          onArrowKeys={onArrowKeys}
        />
      ) : null}
    </figure>
  );
}

function PhotoNavigation({
  listingTitle,
  onPrevious,
  onNext,
  onArrowKeys,
}: {
  listingTitle: string;
  onPrevious: () => void;
  onNext: () => void;
  onArrowKeys: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="listing-photo-controls" aria-label="Photo navigation controls">
      <button
        type="button"
        className="listing-photo-arrow listing-photo-arrow-previous"
        aria-label={`Show previous photo for ${listingTitle}`}
        onClick={onPrevious}
        onKeyDown={onArrowKeys}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        type="button"
        className="listing-photo-arrow listing-photo-arrow-next"
        aria-label={`Show next photo for ${listingTitle}`}
        onClick={onNext}
        onKeyDown={onArrowKeys}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

/** The map tile plus photo thumbnails used to jump straight to one item. */
function MediaStrip({
  className,
  thumbnailsClassName,
  listingTitle,
  photoUrls,
  selectedMediaIndex,
  isMapSelected,
  onSelectMap,
  onSelectPhoto,
  onArrowKeys,
}: {
  className?: string;
  thumbnailsClassName?: string;
  listingTitle: string;
  photoUrls: string[];
  selectedMediaIndex: number;
  isMapSelected: boolean;
  onSelectMap: () => void;
  onSelectPhoto: (index: number) => void;
  onArrowKeys: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={joinClassNames("listing-photo-media-strip", className)}
      aria-label="Choose listing photo or map"
    >
      <button
        type="button"
        className="listing-photo-thumbnail listing-map-thumbnail"
        aria-label={`Show map for ${listingTitle}`}
        aria-current={isMapSelected ? "true" : undefined}
        onClick={onSelectMap}
        onKeyDown={onArrowKeys}
      >
        <MapIcon aria-hidden="true" />
        <span>Map</span>
      </button>
      <div
        className={joinClassNames("listing-photo-thumbnails", thumbnailsClassName)}
        aria-label="Choose listing photo"
      >
        {photoUrls.map((photoUrl, index) => (
          <button
            type="button"
            key={photoUrl}
            className="listing-photo-thumbnail"
            aria-label={`Show photo ${index + 1} of ${photoUrls.length} for ${listingTitle}`}
            aria-current={index + 1 === selectedMediaIndex ? "true" : undefined}
            onClick={() => onSelectPhoto(index + 1)}
            onKeyDown={onArrowKeys}
          >
            <Image unoptimized fill sizes={thumbnailPhotoSizes} src={photoUrl} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

function joinClassNames(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}
