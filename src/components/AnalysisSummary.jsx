import { getReportSummary, getReportTitle } from '../utils/report.js';

export default function AnalysisSummary({ report }) {
  const summary = getReportSummary(report);

  return (
    <div className="analysis-summary">
      <div className="summary-main">
        <strong>{getReportTitle(report)}</strong>
        <span>심각도 {summary.severity}/10</span>
      </div>
      <div className="summary-tags">
        <span>{summary.laws}</span>
      </div>
      <p>{summary.expectedSolution}</p>
      <p>{summary.processingMethod}</p>
    </div>
  );
}
