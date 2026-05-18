export const REPORT_STATUS = {
  RECEIVED: '접수대기',
  IN_REVIEW: '검토중',
  REPAIRING: '보수중',
  COMPLETED: '처리완료'
};

export const STATUS_OPTIONS = Object.values(REPORT_STATUS);

const STATUS_LABELS = {
  [REPORT_STATUS.RECEIVED]: '접수대기',
  [REPORT_STATUS.IN_REVIEW]: '검토중',
  [REPORT_STATUS.REPAIRING]: '보수중',
  [REPORT_STATUS.COMPLETED]: '처리완료'
};

const STATUS_TONES = {
  [REPORT_STATUS.RECEIVED]: 'status-waiting',
  [REPORT_STATUS.IN_REVIEW]: 'status-review',
  [REPORT_STATUS.REPAIRING]: 'status-repairing',
  [REPORT_STATUS.COMPLETED]: 'status-completed'
};

export function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || REPORT_STATUS.RECEIVED;
}

export function getStatusTone(status) {
  return STATUS_TONES[status] || 'status-waiting';
}
