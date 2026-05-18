const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

const dbName = process.env.DB_NAME || 'construction_defect';
const adminId = process.env.ADMIN_USERID || 'test';
const adminPassword = process.env.ADMIN_PASSWORD || '1111';
const adminName = process.env.ADMIN_NAME || '관리자';

async function ensureIndex(connection, dbName, tableName, indexName, columnName) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = ?
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [dbName, tableName, indexName]
  );

  if (rows.length === 0) {
    await connection.query(
      `ALTER TABLE \`${dbName}\`.\`${tableName}\` ADD INDEX \`${indexName}\` (\`${columnName}\`)`
    );
  }
}

async function ensureColumn(connection, dbName, tableName, columnName, definition) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [dbName, tableName, columnName]
  );

  if (rows.length === 0) {
    await connection.query(
      `ALTER TABLE \`${dbName}\`.\`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`
    );
  }
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );

    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const schemaWithoutIndexes = schemaSql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('CREATE INDEX '))
      .join('\n');
    await connection.query(schemaWithoutIndexes);
    await connection.query(
      `ALTER TABLE \`${dbName}\`.reports MODIFY COLUMN defect_type VARCHAR(255) NOT NULL`
    );
    await ensureColumn(connection, dbName, 'reports', 'image_path', 'VARCHAR(500) NULL AFTER `image_url`');
    await ensureColumn(connection, dbName, 'reports', 'image_mime_type', 'VARCHAR(100) NULL AFTER `image_path`');
    await ensureColumn(connection, dbName, 'reports', 'image_size', 'INT NULL AFTER `image_mime_type`');
    await ensureColumn(connection, dbName, 'reports', 'location', 'VARCHAR(255) NULL AFTER `image_size`');
    await ensureColumn(connection, dbName, 'reports', 'address', 'VARCHAR(500) NULL AFTER `location`');
    await ensureColumn(connection, dbName, 'reports', 'space_type', 'VARCHAR(100) NULL AFTER `address`');
    await ensureColumn(connection, dbName, 'reports', 'defect_area', 'VARCHAR(255) NULL AFTER `space_type`');
    await ensureColumn(connection, dbName, 'reports', 'user_description', 'TEXT NULL AFTER `defect_area`');
    await ensureColumn(connection, dbName, 'reports', 'urgency', 'VARCHAR(50) NULL DEFAULT \'보통\' AFTER `user_description`');
    await ensureColumn(connection, dbName, 'reports', 'contact_phone', 'VARCHAR(50) NULL AFTER `urgency`');
    await ensureIndex(connection, dbName, 'reports', 'idx_reports_user_id', 'user_id');
    await ensureIndex(connection, dbName, 'reports', 'idx_reports_status', 'status');
    await ensureIndex(connection, dbName, 'reports', 'idx_reports_defect_type', 'defect_type');
    await ensureIndex(connection, dbName, 'report_status_history', 'idx_history_report_id', 'report_id');
    await ensureIndex(connection, dbName, 'report_images', 'idx_report_images_report_id', 'report_id');

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await connection.query(
      `
        INSERT INTO \`${dbName}\`.users (userid, password, name, role)
        VALUES (?, ?, ?, 'admin')
        ON DUPLICATE KEY UPDATE
          password = VALUES(password),
          name = VALUES(name),
          role = 'admin'
      `,
      [adminId, hashedPassword, adminName]
    );

    console.log(`Database ready: ${dbName}`);
    console.log(`Admin account ready: ${adminId} / ${adminPassword}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('DB setup failed:', error.message);
  process.exit(1);
});
