export default function ImagePreviewModal({ image, onClose }) {
  if (!image) {
    return null;
  }

  return (
    <div className="image-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="image-modal"
        role="dialog"
        aria-modal="true"
        aria-label="하자 사진 크게 보기"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="image-modal-header">
          <div>
            <p className="eyebrow">Photo preview</p>
            <h2>{image.title}</h2>
          </div>
          <button className="modal-close-button" type="button" onClick={onClose} aria-label="사진 닫기">
            닫기
          </button>
        </header>
        <div className="image-modal-body">
          <img src={image.src} alt={image.title} />
        </div>
      </section>
    </div>
  );
}
