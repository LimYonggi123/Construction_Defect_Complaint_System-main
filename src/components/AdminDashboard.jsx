import { useEffect, useState } from 'react';
import AppShell from './AppShell.jsx';
import AnalysisSummary from './AnalysisSummary.jsx';
import ImageGallery from './ImageGallery.jsx';
import ImagePreviewModal from './ImagePreviewModal.jsx';
import { getReportImageSrc, getReportSummary, getReportTitle } from '../utils/report.js';
import { getStatusLabel, getStatusTone, STATUS_OPTIONS } from '../utils/status.js';

function AdminReportDetailModal({ report, displayNumber, onClose, onUpdateStatus, onPreviewImage }) {
  if (!report) return null;

  const summary = getReportSummary(report);
  const visibleNumber = displayNumber || report.id;
  const complaintRows = [
    ['위치', report.location],
    ['상세 주소', report.address],
    ['공간 구분', report.space_type],
    ['하자 발생 부위', report.defect_area],
    ['긴급도', report.urgency || '보통'],
    ['연락처', report.contact_phone],
    ['사용자 설명', report.user_description]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');

  return (
    <div className="image-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="admin-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`#${visibleNumber} 민원 상세`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="image-modal-header">
          <div>
            <p className="eyebrow">Complaint detail</p>
            <h2>#{visibleNumber} {getReportTitle(report)}</h2>
          </div>
          <button className="modal-close-button" type="button" onClick={onClose} aria-label="상세 닫기">
            닫기
          </button>
        </header>

        <div className="admin-detail-body">
          <div className="admin-detail-gallery">
            <ImageGallery report={report} title={`#${visibleNumber} 첨부 사진`} onPreview={onPreviewImage} />
          </div>

          <div className="admin-detail-content">
            <section className="detail-section">
              <div className="detail-section-header">
                <h3>접수 정보</h3>
                <label className={`status-select-wrap ${getStatusTone(report.status)}`}>
                  <select
                    className="status-select"
                    value={report.status}
                    onChange={(event) => onUpdateStatus(report.id, event.target.value)}
                    aria-label={`#${report.id} 상태 변경`}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {getStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="detail-info-grid">
                <div>
                  <span>접수자</span>
                  <strong>{report.user_name || `사용자 ${report.user_id}`}</strong>
                </div>
                <div>
                  <span>접수일</span>
                  <strong>{new Date(report.created_at).toLocaleString()}</strong>
                </div>
                <div>
                  <span>긴급도</span>
                  <strong>{report.urgency || '보통'}</strong>
                </div>
                <div>
                  <span>연락처</span>
                  <strong>{report.contact_phone || '미입력'}</strong>
                </div>
              </div>
            </section>

            <section className="detail-section">
              <h3>민원 정보</h3>
              <div className="detail-row-list">
                {complaintRows.map(([label, value]) => (
                  <div className="detail-row" key={label}>
                    <span>{label}</span>
                    <p>{value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <h3>AI 분석 요약</h3>
              <div className="admin-analysis-grid">
                <div>
                  <span>하자 내용</span>
                  <strong>{getReportTitle(report)}</strong>
                </div>
                <div>
                  <span>심각도</span>
                  <strong>{summary.severity}/10</strong>
                </div>
                <div>
                  <span>예상 해결 방법</span>
                  <p>{summary.expectedSolution}</p>
                </div>
                <div>
                  <span>처리 방법</span>
                  <p>{summary.processingMethod}</p>
                </div>
                <div>
                  <span>관련 법규</span>
                  <p>{summary.laws}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function AdminDashboard({ allReports, onLogout, onUpdateStatus }) {
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedDisplayNumber, setSelectedDisplayNumber] = useState(null);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(null);

  useEffect(() => {
    if (!selectedReport) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedReport(null);
        setSelectedDisplayNumber(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedReport]);

  useEffect(() => {
    if (!selectedReport) return;
    const latestReport = allReports.find((report) => report.id === selectedReport.id);
    if (latestReport) {
      setSelectedReport(latestReport);
    }
  }, [allReports, selectedReport?.id]);

  return (
    <AppShell>
      <main className="page page-wide">
        <header className="topbar topbar-actions">
          <button className="button button-secondary" onClick={onLogout}>로그아웃</button>
        </header>

        <section className="page-heading">
          <div>
            <p className="eyebrow">Admin dashboard</p>
            <h1>관리자 민원 관리</h1>
            <p>접수된 건설 하자 민원의 처리 현황을 확인하고 상태를 변경합니다.</p>
          </div>
          <div className="metric-box">
            <span>전체 민원</span>
            <strong>{allReports.length}</strong>
          </div>
        </section>

        <section className="table-section" aria-label="전체 민원 목록">
          <div className="section-header">
            <h2>접수 목록</h2>
            <p>민원을 선택하면 사진 갤러리와 상세 정보를 확인할 수 있습니다.</p>
          </div>

          <div className="table-wrap">
            <table className="data-table admin-data-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>작성자</th>
                  <th>사진</th>
                  <th>하자 제목</th>
                  <th>분석 요약</th>
                  <th>상태</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {allReports.length === 0 ? (
                  <tr>
                    <td className="empty-cell" colSpan="7">접수된 민원이 없습니다.</td>
                  </tr>
                ) : (
                  allReports.map((report, index) => {
                    const imageSrc = getReportImageSrc(report);
                    const imageCount = report.images?.length || (imageSrc ? 1 : 0);
                    const displayNumber = index + 1;

                    return (
                      <tr key={report.id}>
                        <td>#{displayNumber}</td>
                        <td>{report.user_name}</td>
                        <td>
                          <button
                            className="image-thumb-button"
                            type="button"
                            disabled={!imageSrc}
                            onClick={() => {
                              setSelectedReport(report);
                              setSelectedDisplayNumber(displayNumber);
                            }}
                            aria-label={`#${displayNumber} 민원 상세 보기`}
                          >
                            <img className="thumb thumb-small" src={imageSrc} alt="하자" />
                            {imageCount > 1 && <span className="image-count-badge">+{imageCount - 1}</span>}
                          </button>
                        </td>
                        <td className="defect-cell">{getReportTitle(report)}</td>
                        <td className="summary-cell">
                          <AnalysisSummary report={report} />
                        </td>
                        <td>
                          <label className={`status-select-wrap ${getStatusTone(report.status)}`}>
                            <select
                              className="status-select"
                              value={report.status}
                              onChange={(event) => onUpdateStatus(report.id, event.target.value)}
                              aria-label={`#${report.id} 상태 변경`}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {getStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </td>
                        <td>
                          <button
                            className="button button-small button-secondary"
                            type="button"
                            onClick={() => {
                              setSelectedReport(report);
                              setSelectedDisplayNumber(displayNumber);
                            }}
                          >
                            상세 보기
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <AdminReportDetailModal
        report={selectedReport}
        displayNumber={selectedDisplayNumber}
        onClose={() => {
          setSelectedReport(null);
          setSelectedDisplayNumber(null);
        }}
        onUpdateStatus={onUpdateStatus}
        onPreviewImage={setSelectedPreviewImage}
      />
      <ImagePreviewModal image={selectedPreviewImage} onClose={() => setSelectedPreviewImage(null)} />
    </AppShell>
  );
}
