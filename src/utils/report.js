import { API_BASE_URL } from '../api/client.js';

function getFirstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }

  return value || '';
}

function makeShortText(value, maxLength = 28) {
  const text = String(value || '')
    .replace(/^하자\s*내용\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '하자 민원';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function uniqueJoin(items, separator = '·') {
  return [...new Set(items.filter(Boolean))].join(separator);
}

function summarizeDefectTitle(report, defectText) {
  const text = `${defectText} ${report.defect_area || ''} ${report.space_type || ''}`;
  const places = [];
  const issues = [];

  if (includesAny(text, ['욕실', '화장실', '세면대', '수납장'])) places.push('욕실');
  if (includesAny(text, ['바닥', '콘크리트', '마감면'])) places.push('바닥');
  if (includesAny(text, ['벽', '벽면', '벽체'])) places.push('벽체');
  if (includesAny(text, ['배관', '수도', '설비'])) places.push('배관');
  if (includesAny(text, ['천장'])) places.push('천장');
  if (includesAny(text, ['타일'])) places.push('타일');

  if (includesAny(text, ['균열', '갈라짐', '크랙'])) issues.push('균열');
  if (includesAny(text, ['박리', '파손', '깨짐'])) issues.push('박리·파손');
  if (includesAny(text, ['떨어', '들뜸', '미마감', '마감이 불량', '마감 불량', '마감 상태'])) issues.push('마감 불량');
  if (includesAny(text, ['누수', '물이 새', '물 샘'])) issues.push('누수 의심');
  if (includesAny(text, ['오염', '곰팡이'])) issues.push('오염');

  const placeTitle = uniqueJoin(places.slice(0, 3));
  const issueTitle = uniqueJoin(issues.slice(0, 2));

  if (placeTitle && issueTitle) return `${placeTitle} ${issueTitle}`;
  if (issueTitle) return issueTitle;
  if (placeTitle) return `${placeTitle} 하자`;
  return makeShortText(defectText);
}

export function getReportImageSrc(report, imageIndex = 0) {
  const image = getReportImages(report)[imageIndex];
  const imageSource = image?.image_url || report.image_url || report.image_data;

  if (!imageSource) {
    return '';
  }

  if (imageSource.startsWith('data:') || imageSource.startsWith('http')) {
    return imageSource;
  }

  return `${API_BASE_URL}${imageSource}`;
}

export function getReportImages(report) {
  const images = Array.isArray(report.images)
    ? [...report.images].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    : [];

  if (images.length > 0) {
    return images;
  }

  if (report.image_url || report.image_data) {
    return [{
      image_url: report.image_url || report.image_data,
      image_path: report.image_path,
      image_mime_type: report.image_mime_type,
      image_size: report.image_size,
      sort_order: 0
    }];
  }

  return [];
}

export function getReportSummary(report) {
  const analysis = report.analysis_json || {};
  const relatedLaws = normalizeTextList(analysis.relatedLaws);
  const repairMethods = normalizeTextList(analysis.repairMethods);

  return {
    defect: getFirstValue(report.defect_type, analysis.defectContent, analysis.defectType, '미분류'),
    severity: getFirstValue(report.severity_score, analysis.severityScore, '미정'),
    expectedSolution: getFirstValue(analysis.expectedSolution, repairMethods, analysis.summary, '검토 필요'),
    processingMethod: getFirstValue(analysis.processingMethod, '관리자 검토 후 처리'),
    laws: getFirstValue(relatedLaws, '확인 필요')
  };
}

export function getReportTitle(report) {
  const summary = getReportSummary(report);
  return summarizeDefectTitle(report, summary.defect);
}

export function getReportDetailRows(report) {
  const summary = getReportSummary(report);
  const location = getFirstValue(report.location, report.address);
  const area = getFirstValue(report.defect_area, report.space_type);

  return [
    location ? ['위치', location] : null,
    area ? ['부위', area] : null,
    ['하자 내용', summary.defect],
    ['심각도', summary.severity],
    ['예상 해결 방법', summary.expectedSolution],
    ['처리 방법', summary.processingMethod],
    ['관련 법규', summary.laws]
  ].filter(Boolean);
}

export function formatReportPreview(report) {
  return getReportDetailRows(report)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}
