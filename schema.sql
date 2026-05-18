CREATE DATABASE IF NOT EXISTS construction_defect
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE construction_defect;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userid VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  defect_type VARCHAR(255) NOT NULL,
  severity_score TINYINT NOT NULL,
  estimated_repair_cost INT NULL,
  expected_processing_days INT NULL,
  actual_processing_days INT NULL,
  analysis_text TEXT NOT NULL,
  analysis_json JSON NOT NULL,
  image_data LONGTEXT NULL,
  image_url VARCHAR(500) NULL,
  image_path VARCHAR(500) NULL,
  image_mime_type VARCHAR(100) NULL,
  image_size INT NULL,
  location VARCHAR(255) NULL,
  address VARCHAR(500) NULL,
  space_type VARCHAR(100) NULL,
  defect_area VARCHAR(255) NULL,
  user_description TEXT NULL,
  urgency VARCHAR(50) NULL DEFAULT '보통',
  contact_phone VARCHAR(50) NULL,
  status ENUM('접수대기', '검토중', '보수중', '처리완료') NOT NULL DEFAULT '접수대기',
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_reports_severity
    CHECK (severity_score BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS report_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  status ENUM('접수대기', '검토중', '보수중', '처리완료') NOT NULL,
  changed_by INT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_report
    FOREIGN KEY (report_id) REFERENCES reports(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_history_user
    FOREIGN KEY (changed_by) REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS report_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_id INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  image_mime_type VARCHAR(100) NOT NULL,
  image_size INT NULL,
  width INT NULL,
  height INT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_images_report
    FOREIGN KEY (report_id) REFERENCES reports(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_defect_type ON reports(defect_type);
CREATE INDEX idx_history_report_id ON report_status_history(report_id);
CREATE INDEX idx_report_images_report_id ON report_images(report_id);
