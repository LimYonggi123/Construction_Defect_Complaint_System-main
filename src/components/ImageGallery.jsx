import { useEffect, useMemo, useState } from 'react';
import { getReportImages, getReportImageSrc } from '../utils/report.js';

export default function ImageGallery({ report, title = '첨부 사진', compact = false, onPreview }) {
  const images = useMemo(() => getReportImages(report), [report]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [report?.id, images.length]);

  if (images.length === 0) {
    return (
      <div className="gallery-empty">
        <strong>{title}</strong>
        <span>등록된 사진이 없습니다.</span>
      </div>
    );
  }

  const selectedSrc = getReportImageSrc(report, selectedIndex);
  const selectedNumber = selectedIndex + 1;

  return (
    <section className={`image-gallery ${compact ? 'image-gallery-compact' : ''}`} aria-label={title}>
      <button
        className="gallery-main"
        type="button"
        onClick={() => onPreview?.({ src: selectedSrc, title: `${title} ${selectedNumber}` })}
        aria-label={`${title} 크게 보기`}
      >
        <img src={selectedSrc} alt={`${title} ${selectedNumber}`} />
        <span className="gallery-count">{selectedNumber} / {images.length}</span>
      </button>

      {images.length > 1 && (
        <div className="gallery-thumbs" aria-label="첨부 사진 목록">
          {images.map((image, index) => (
            <button
              key={image.id || image.image_url || index}
              className={index === selectedIndex ? 'is-active' : ''}
              type="button"
              onClick={() => setSelectedIndex(index)}
              aria-label={`${index + 1}번째 사진 보기`}
            >
              <img src={getReportImageSrc(report, index)} alt={`${index + 1}번째 첨부 사진`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
