"use client";

import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Map as MapIcon, X } from "lucide-react";
import type { InviteIdentity, ListingCandidate } from "@/lib/listings";
import { ListingInlineMap } from "./map/LeafletListingMap";

export type ListingMediaProps = {
  identity?: InviteIdentity | undefined;
  listing: ListingCandidate;
};

export function ListingMedia({ identity, listing }: ListingMediaProps) {
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const selectedListingId = listing.id;
  const photoUrls = listing.photos.filter(Boolean);
  const mediaItemCount = photoUrls.length + 1;
  const mapMediaIndex = 0;
  const isMapSelected = selectedMediaIndex === mapMediaIndex;
  const selectedPhotoUrl = !isMapSelected
    ? (photoUrls[selectedMediaIndex - 1] ?? photoUrls[0])
    : undefined;
  const showPhotoControls = mediaItemCount > 1;
  const photoPositionLabel = `${selectedMediaIndex + 1} of ${mediaItemCount}`;
  const photoAltText = `${listing.title} photo ${selectedMediaIndex}`;

  useEffect(() => {
    setSelectedMediaIndex(0);
    setIsPhotoModalOpen(false);
  }, [selectedListingId]);

  useEffect(() => {
    if (!isPhotoModalOpen) {
      return;
    }

    function handleModalKeyDown(event: KeyboardEvent) {
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

    window.addEventListener("keydown", handleModalKeyDown);
    return () => window.removeEventListener("keydown", handleModalKeyDown);
  }, [isPhotoModalOpen, mediaItemCount]);

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
  const handlePhotoCarouselKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!showPhotoControls) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      handlePreviousPhoto();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      handleNextPhoto();
    }
  };

  const listingMap = <ListingInlineMap identity={identity} listing={listing} />;
  const sharedFrameProps = {
    listingTitle: listing.title,
    positionLabel: photoPositionLabel,
    showNavigation: showPhotoControls,
    onPrevious: handlePreviousPhoto,
    onNext: handleNextPhoto,
  };
  const sharedStripProps = {
    listingTitle: listing.title,
    photoUrls,
    selectedMediaIndex,
    isMapSelected,
    onSelectMap: () => setSelectedMediaIndex(mapMediaIndex),
    onSelectPhoto: selectPhoto,
  };

  return (
    <>
      <section
        className="listing-photo-carousel"
        aria-label={`Media for ${listing.title}`}
        tabIndex={showPhotoControls ? 0 : undefined}
        onKeyDown={handlePhotoCarouselKeyDown}
      >
        <PhotoFrame {...sharedFrameProps}>
          {isMapSelected ? (
            listingMap
          ) : selectedPhotoUrl ? (
            <button
              type="button"
              className="listing-photo-open"
              aria-label={`Enlarge photo ${selectedMediaIndex} of ${photoUrls.length} for ${listing.title}`}
              onClick={() => setIsPhotoModalOpen(true)}
            >
              <img src={selectedPhotoUrl} alt={photoAltText} loading="lazy" />
            </button>
          ) : null}
        </PhotoFrame>
        {showPhotoControls ? <MediaStrip {...sharedStripProps} /> : null}
      </section>

      {isPhotoModalOpen ? (
        <div
          className="listing-photo-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Enlarged photos for ${listing.title}`}
        >
          <button
            type="button"
            className="listing-photo-modal-backdrop"
            aria-label="Close enlarged photo carousel"
            onClick={() => setIsPhotoModalOpen(false)}
          />
          <section className="listing-photo-modal-panel" aria-label={`Photos for ${listing.title}`}>
            <div className="listing-photo-modal-header">
              <div>
                <p className="eyebrow">Photos</p>
                <h3>{listing.title}</h3>
              </div>
              <button
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
                <img src={selectedPhotoUrl} alt={photoAltText} />
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
        </div>
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
  children,
}: {
  className?: string;
  listingTitle: string;
  positionLabel: string;
  showNavigation: boolean;
  onPrevious: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  return (
    <figure className={joinClassNames("listing-photo-frame", className)}>
      {children}
      <figcaption className="listing-photo-count">{positionLabel}</figcaption>
      {showNavigation ? (
        <PhotoNavigation listingTitle={listingTitle} onPrevious={onPrevious} onNext={onNext} />
      ) : null}
    </figure>
  );
}

function PhotoNavigation({
  listingTitle,
  onPrevious,
  onNext,
}: {
  listingTitle: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="listing-photo-controls" aria-label="Photo navigation controls">
      <button
        type="button"
        className="listing-photo-arrow listing-photo-arrow-previous"
        aria-label={`Show previous photo for ${listingTitle}`}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        type="button"
        className="listing-photo-arrow listing-photo-arrow-next"
        aria-label={`Show next photo for ${listingTitle}`}
        onClick={onNext}
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
}: {
  className?: string;
  thumbnailsClassName?: string;
  listingTitle: string;
  photoUrls: string[];
  selectedMediaIndex: number;
  isMapSelected: boolean;
  onSelectMap: () => void;
  onSelectPhoto: (index: number) => void;
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
            key={`${photoUrl}-${index}`}
            className="listing-photo-thumbnail"
            aria-label={`Show photo ${index + 1} of ${photoUrls.length} for ${listingTitle}`}
            aria-current={index + 1 === selectedMediaIndex ? "true" : undefined}
            onClick={() => onSelectPhoto(index + 1)}
          >
            <img src={photoUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}

function joinClassNames(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}
