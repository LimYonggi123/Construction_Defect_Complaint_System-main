import { useState } from 'react';
import AppShell from './AppShell.jsx';
import ImageGallery from './ImageGallery.jsx';
import ImagePreviewModal from './ImagePreviewModal.jsx';
import { getReportDetailRows, getReportImageSrc, getReportTitle } from '../utils/report.js';
import { getStatusLabel, getStatusTone } from '../utils/status.js';

const STEPS = [
  { key: 'upload', label: '사진 등록' },
  { key: 'analysis', label: 'AI 분석' },
  { key: 'details', label: '민원 정보' },
  { key: 'complete', label: '접수 완료' }
];

const URGENCY_OPTIONS = ['낮음', '보통', '높음', '긴급'];

function getStepIndex(step) {
  return Math.max(0, STEPS.findIndex((item) => item.key === step));
}

function Stepper({ currentStep }) {
  const currentIndex = getStepIndex(currentStep);

  return (
    <ol className="complaint-stepper" aria-label="민원 접수 단계">
      {STEPS.map((step, index) => (
        <li
          key={step.key}
          className={`${index <= currentIndex ? 'is-active' : ''} ${index === currentIndex ? 'is-current' : ''}`}
        >
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
        </li>
      ))}
    </ol>
  );
}

function UploadArea({
  selectedImages,
  imageStatus,
  imageError,
  isDraggingImage,
  onDragOver,
  onDragLeave,
  onDrop,
  onImageUpload,
  onRemoveImage,
  onClearImages
}) {
  return (
    <div
      className={`upload-dropzone ${selectedImages.length > 0 ? 'has-image' : ''} ${isDraggingImage ? 'is-dragging' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="upload-dropzone-copy">
        <strong>하자 사진을 등록해 주세요</strong>
        <span>여러 장을 등록할 수 있고, 첫 번째 사진이 대표 이미지로 사용됩니다.</span>
      </div>

      <label className="button button-primary upload-action">
        <input type="file" onChange={onImageUpload} accept="image/*" capture="environment" multiple />
        사진 선택
      </label>

      {selectedImages.length > 0 ? (
        <>
          <div className="upload-preview-grid full">
            {selectedImages.map((image, index) => (
              <div className="upload-preview-tile large" key={image.id}>
                <img className="thumb upload-preview-image" src={image.preview} alt={`선택한 하자 사진 ${index + 1}`} />
                {index === 0 && <span className="primary-image-badge">대표</span>}
                <button type="button" onClick={() => onRemoveImage(image.id)} aria-label="사진 삭제">
                  삭제
                </button>
              </div>
            ))}
          </div>

          <div className="upload-status-row">
            <span>{selectedImages.length}장 선택됨</span>
            <span>
              {imageStatus === 'processing' && '이미지를 준비하는 중입니다.'}
              {imageStatus === 'ready' && '분석 가능한 상태입니다.'}
              {imageStatus === 'error' && imageError}
            </span>
            <button className="button button-small button-secondary" type="button" onClick={onClearImages}>
              전체 삭제
            </button>
          </div>
        </>
      ) : (
        <div className="upload-empty-helper">
          <span>파일을 이 영역에 끌어다 놓아도 됩니다.</span>
        </div>
      )}
    </div>
  );
}

function AnalysisResultCard({ analysis }) {
  if (!analysis) return null;

  const fields = [
    ['하자 내용', analysis.defectContent],
    ['심각도', `${analysis.severityScore}/10`],
    ['예상 해결 방법', analysis.expectedSolution],
    ['처리 방법', analysis.processingMethod],
    ['관련 법규', analysis.relatedLaws]
  ];

  return (
    <div className="analysis-result-card">
      {fields.map(([label, value]) => (
        <div className="result-row" key={label}>
          <span>{label}</span>
          <strong>{value || '정보 없음'}</strong>
        </div>
      ))}
    </div>
  );
}

function ReportListView({ reports, onCreate, onDeleteReport, onPreviewImage }) {
  const [expandedReportId, setExpandedReportId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const handleDeleteClick = (reportId) => {
    if (deleteConfirmId !== reportId) {
      setDeleteConfirmId(reportId);
      return;
    }

    onDeleteReport(reportId);
    setExpandedReportId(null);
    setDeleteConfirmId(null);
  };

  return (
    <section className="table-section user-reports-section">
      <div className="section-header reports-header">
        <div>
          <h2>내 민원</h2>
          <p>내가 접수한 민원의 처리 상태를 확인합니다.</p>
        </div>
        <button className="button button-primary" onClick={onCreate}>
          새 민원 접수
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="empty-state compact">
          <strong>접수 내역 없음</strong>
          <span>민원을 접수하면 이곳에 표시됩니다.</span>
        </div>
      ) : (
        <div className="user-report-grid">
          {reports.map((report, index) => {
            const isExpanded = expandedReportId === report.id;
            const displayNumber = index + 1;

            return (
              <article className={`user-report-card ${isExpanded ? 'is-expanded' : ''}`} key={report.id}>
                <button
                  className="user-report-summary"
                  type="button"
                  onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                  aria-expanded={isExpanded}
                >
                  <img className="thumb user-report-image" src={getReportImageSrc(report)} alt="하자" />
                  <div className="user-report-content">
                    <div className="user-report-title-row">
                      <div>
                        <div className="report-meta">
                          <span>#{displayNumber}</span>
                          <span>{new Date(report.created_at).toLocaleString()}</span>
                        </div>
                        <strong>{getReportTitle(report)}</strong>
                      </div>
                      <span className={`status-badge report-status-fixed ${getStatusTone(report.status)}`}>
                        {getStatusLabel(report.status)}
                      </span>
                    </div>
                    <span className="report-open-hint">
                      {isExpanded ? '상세 내용 닫기' : '상세 내용 보기'}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="user-report-detail">
                    <ImageGallery
                      report={report}
                      title={`#${displayNumber} 첨부 사진`}
                      compact
                      onPreview={onPreviewImage}
                    />
                    {getReportDetailRows(report).map(([label, value]) => (
                      <div className="detail-row" key={label}>
                        <span>{label}</span>
                        <p>{value}</p>
                      </div>
                    ))}
                    <div className="report-detail-actions">
                      <button
                        className={`button button-small ${deleteConfirmId === report.id ? 'button-danger' : 'button-secondary'}`}
                        type="button"
                        onClick={() => handleDeleteClick(report.id)}
                      >
                        {deleteConfirmId === report.id ? '삭제 확인' : '민원 삭제'}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function UserDashboard({
  user,
  reports,
  loading,
  selectedImages,
  imageStatus,
  imageError,
  input,
  setInput,
  complaintStep,
  setComplaintStep,
  analysisResult,
  complaintInfo,
  onLogout,
  onImageUpload,
  onImageDrop,
  onRemoveImage,
  onClearImages,
  onAnalyzeReport,
  onComplaintInfoChange,
  onSaveReport,
  onDeleteReport,
  onStartNewReport
}) {
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [activeView, setActiveView] = useState('create');
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(null);

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDraggingImage(true);
  };

  const handleDragLeave = () => {
    setIsDraggingImage(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDraggingImage(false);
    onImageDrop(Array.from(event.dataTransfer.files || []));
  };

  const handleCreateClick = () => {
    setActiveView('create');
  };

  const handleNewReport = () => {
    onStartNewReport();
    setActiveView('create');
  };

  return (
    <AppShell>
      <main className="page page-wide">
        <header className="topbar topbar-actions">
          <button className="button button-secondary" onClick={onLogout}>로그아웃</button>
        </header>

        <section className="page-heading user-page-heading">
          <div>
            <p className="eyebrow">Complaint service</p>
            <h1>{activeView === 'create' ? `${user.name}님의 하자 민원 접수` : '내 민원 조회'}</h1>
            <p>
              {activeView === 'create'
                ? '사진 분석부터 민원 정보 입력, 최종 접수까지 순서대로 진행합니다.'
                : '접수한 민원의 진행 상태와 분석 내용을 확인합니다.'}
            </p>
          </div>
          <div className="metric-box">
            <span>내 민원</span>
            <strong>{reports.length}</strong>
          </div>
        </section>

        <nav className="view-tabs" aria-label="사용자 화면 전환">
          <button
            className={activeView === 'create' ? 'is-active' : ''}
            type="button"
            onClick={handleCreateClick}
          >
            민원 접수
          </button>
          <button
            className={activeView === 'reports' ? 'is-active' : ''}
            type="button"
            onClick={() => setActiveView('reports')}
          >
            내 민원
          </button>
        </nav>

        {activeView === 'reports' ? (
          <ReportListView
            reports={reports}
            onCreate={handleNewReport}
            onDeleteReport={onDeleteReport}
            onPreviewImage={setSelectedPreviewImage}
          />
        ) : (
          <section className="single-workspace">
            <div className="analysis-panel complaint-panel">
              <Stepper currentStep={complaintStep} />

              {complaintStep === 'upload' && (
                <div className="complaint-stage">
                  <div className="section-header">
                    <h2>1. 사진 등록 및 민원 설명</h2>
                    <p>하자 부위가 잘 보이는 사진을 등록하고, 민원인이 확인한 문제 상황을 적어 주세요.</p>
                  </div>

                  <UploadArea
                    selectedImages={selectedImages}
                    imageStatus={imageStatus}
                    imageError={imageError}
                    isDraggingImage={isDraggingImage}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onImageUpload={onImageUpload}
                    onRemoveImage={onRemoveImage}
                    onClearImages={onClearImages}
                  />

                  <label className="field">
                    민원 설명
                    <textarea
                      className="textarea"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="예: 거실 바닥에 균열이 생겼고 일부가 들떠 있습니다. 언제부터 보였는지, 생활에 어떤 불편이 있는지 적어 주세요."
                    />
                  </label>

                  <div className="form-actions">
                    <button
                      className="button button-primary"
                      onClick={onAnalyzeReport}
                      disabled={loading || imageStatus === 'processing' || selectedImages.length === 0}
                    >
                      AI 분석 시작
                    </button>
                  </div>
                </div>
              )}

              {complaintStep === 'analysis' && (
                <div className="complaint-stage">
                  <div className="section-header">
                    <h2>2. AI 분석 결과</h2>
                    <p>AI 분석 결과는 접수 자료로 함께 저장됩니다. 내용은 관리자가 검토합니다.</p>
                  </div>

                  {loading ? (
                    <div className="process-state">
                      <strong>AI가 사진을 분석 중입니다.</strong>
                      <span>하자 내용, 심각도, 처리 방법, 관련 법규를 정리하고 있습니다.</span>
                    </div>
                  ) : (
                    <>
                      <AnalysisResultCard analysis={analysisResult?.structuredResult} />
                      <div className="form-actions">
                        <button className="button button-secondary" onClick={() => setComplaintStep('upload')}>
                          사진/설명 수정
                        </button>
                        <button className="button button-primary" onClick={() => setComplaintStep('details')}>
                          접수 정보 입력
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {complaintStep === 'details' && (
                <div className="complaint-stage">
                  <div className="section-header">
                    <h2>3. 접수 정보 입력</h2>
                    <p>관리자가 현장을 확인할 수 있도록 위치, 부위, 연락처를 입력해 주세요.</p>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      현장 위치
                      <input
                        value={complaintInfo.location}
                        onChange={(event) => onComplaintInfoChange('location', event.target.value)}
                        placeholder="예: 101동 1203호"
                      />
                    </label>

                    <label className="field">
                      상세 주소
                      <input
                        value={complaintInfo.address}
                        onChange={(event) => onComplaintInfoChange('address', event.target.value)}
                        placeholder="예: 서울시 ..."
                      />
                    </label>

                    <label className="field">
                      공간 구분
                      <select
                        value={complaintInfo.space_type}
                        onChange={(event) => onComplaintInfoChange('space_type', event.target.value)}
                      >
                        <option value="">선택 안 함</option>
                        <option value="거실">거실</option>
                        <option value="욕실">욕실</option>
                        <option value="주방">주방</option>
                        <option value="방">방</option>
                        <option value="외벽">외벽</option>
                        <option value="주차장">주차장</option>
                        <option value="공용부">공용부</option>
                        <option value="기타">기타</option>
                      </select>
                    </label>

                    <label className="field">
                      하자 발생 부위
                      <input
                        value={complaintInfo.defect_area}
                        onChange={(event) => onComplaintInfoChange('defect_area', event.target.value)}
                        placeholder="예: 거실 바닥, 욕실 천장"
                      />
                    </label>

                    <label className="field">
                      긴급도
                      <select
                        value={complaintInfo.urgency}
                        onChange={(event) => onComplaintInfoChange('urgency', event.target.value)}
                      >
                        {URGENCY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      연락처
                      <input
                        value={complaintInfo.contact_phone}
                        onChange={(event) => onComplaintInfoChange('contact_phone', event.target.value)}
                        placeholder="예: 010-0000-0000"
                      />
                    </label>

                  </div>

                  <div className="form-actions">
                    <button className="button button-secondary" onClick={() => setComplaintStep('analysis')}>
                      이전
                    </button>
                    <button className="button button-primary" onClick={onSaveReport}>
                      최종 접수
                    </button>
                  </div>
                </div>
              )}

              {complaintStep === 'complete' && (
                <div className="complaint-stage">
                  <div className="complete-state">
                    <span>접수 완료</span>
                    <h2>민원이 정상적으로 접수되었습니다.</h2>
                    <p>처리 상태는 내 민원 화면에서 확인할 수 있습니다.</p>
                    <div className="form-actions">
                      <button className="button button-secondary" onClick={() => setActiveView('reports')}>
                        내 민원 확인
                      </button>
                      <button className="button button-primary" onClick={handleNewReport}>
                        새 민원 접수
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
      <ImagePreviewModal image={selectedPreviewImage} onClose={() => setSelectedPreviewImage(null)} />
    </AppShell>
  );
}
