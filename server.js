const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;

// 1. 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const REPORT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'reports');
fs.mkdirSync(REPORT_UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_ROOT));

// 2. MySQL 연결 설정
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 3. OpenAI 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// 4. 공통 상태값 설정
const REPORT_STATUS = {
  RECEIVED: '접수대기',
  IN_REVIEW: '검토중',
  REPAIRING: '보수중',
  COMPLETED: '처리완료'
};
const ALLOWED_REPORT_STATUSES = Object.values(REPORT_STATUS);

// 이미지는 메모리로 받은 뒤 sharp에서 검증/변환하고, DB에는 파일 경로만 저장한다.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype.startsWith('image/')) {
      return callback(new Error('이미지 파일만 업로드할 수 있습니다.'));
    }

    return callback(null, true);
  }
});

// 로그인 이후 API는 JWT 토큰을 확인해서 사용자/관리자 권한을 구분한다.
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  try {
    req.user = jwt.verify(token, SECRET_KEY);
    return next();
  } catch (error) {
    return res.status(401).json({ error: '유효하지 않은 로그인입니다.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }

  return next();
}

function requireSelfOrAdmin(req, res, next) {
  const targetUserId = Number(req.params.user_id || req.body.user_id);

  if (req.user?.role === 'admin' || req.user?.id === targetUserId) {
    return next();
  }

  return res.status(403).json({ error: '본인 민원만 접근할 수 있습니다.' });
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function validateRequiredFields(fields) {
  const missing = Object.entries(fields)
    .filter(([, value]) => isBlank(value))
    .map(([key]) => key);

  return missing;
}

function parseStructuredAnalysis(value) {
  if (typeof value === 'string') {
    return safeJsonParse(value);
  }

  return value;
}

// AI 분석 결과는 최종 화면/DB에서 쓰는 5개 필드가 모두 있어야 저장한다.
function validateAnalysisPayload(payload) {
  const missing = validateRequiredFields({
    defectContent: payload.defectContent,
    severityScore: payload.severityScore,
    expectedSolution: payload.expectedSolution,
    processingMethod: payload.processingMethod,
    relatedLaws: payload.relatedLaws
  });

  if (missing.length > 0) {
    return `AI 분석 결과 필드가 누락되었습니다: ${missing.join(', ')}`;
  }

  const severityScore = parseInteger(payload.severityScore);
  if (severityScore === null || severityScore < 1 || severityScore > 10) {
    return '심각도는 1~10 사이의 숫자여야 합니다.';
  }

  return null;
}

// 5. 공통 보조 함수

// 배열 필드가 비정상적으로 들어와도 안전하게 정리
function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
}

// 금액 문자열에서 숫자만 추출해 정수로 변환
function parseCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);

  const digits = String(value).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

// 숫자형 입력을 정수로 변환
function parseInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNullableText(value) {
  if (isBlank(value)) return null;
  return String(value).trim();
}

function toColumnText(value, maxLength) {
  const text = toNullableText(value);
  if (!text) return null;
  return text.slice(0, maxLength);
}

// DB JSON 문자열을 객체로 안전하게 변환
function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

// 업로드 이미지는 회전 보정 후 WebP로 저장해 조회 성능과 저장 용량을 관리한다.
async function processReportImage(file) {
  if (!file) {
    return null;
  }

  const filename = `${Date.now()}-${crypto.randomUUID()}.webp`;
  const outputPath = path.join(REPORT_UPLOAD_DIR, filename);

  const image = sharp(file.buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: 82 });

  const info = await image.toFile(outputPath);

  return {
    imageUrl: `/uploads/reports/${filename}`,
    imagePath: path.relative(__dirname, outputPath).replace(/\\/g, '/'),
    mimeType: 'image/webp',
    size: info.size,
    width: info.width,
    height: info.height
  };
}

// 구조화된 분석 결과를 기존 화면용 텍스트로 변환
function buildAnalysisText(analysis) {
  const relatedLaws = Array.isArray(analysis.relatedLaws)
    ? analysis.relatedLaws.join(', ')
    : analysis.relatedLaws || '정보 없음';

  return [
    `하자 내용: ${analysis.defectContent || '미분류'}`,
    `심각도: ${analysis.severityScore ?? '미정'}`,
    `예상 해결 방법: ${analysis.expectedSolution || '정보 없음'}`,
    `처리 방법: ${analysis.processingMethod || '정보 없음'}`,
    `관련 법규: ${relatedLaws}`
  ].join('\n');
}

// AI 응답 JSON을 DB 저장용 형식으로 정규화
function normalizeAnalysisPayload(payload = {}) {
  const repairMethods = normalizeArray(payload.repairMethods).join(', ');
  const relatedLaws = Array.isArray(payload.relatedLaws)
    ? payload.relatedLaws.filter(Boolean).join(', ')
    : payload.relatedLaws;

  const normalized = {
    defectContent: payload.defectContent || payload.defectType || payload.summary || '미분류',
    severityScore: Math.min(Math.max(parseInteger(payload.severityScore) ?? 1, 1), 10),
    expectedSolution: payload.expectedSolution || repairMethods || payload.summary || '전문가 현장 확인 후 보수 계획 수립',
    processingMethod: payload.processingMethod || payload.expectedProcessingMethod || '관리자 검토 후 보수 일정 조율',
    relatedLaws: relatedLaws || '관련 법규 확인 필요'
  };

  return normalized;
}

// AI가 보낸 응답에서 JSON 객체만 추출
function extractAssistantJson(content) {
  if (typeof content !== 'string') {
    throw new Error('AI response content was empty.');
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }

    throw error;
  }
}

// reports 조회 결과를 프론트 응답 형식으로 변환
function formatReportRow(row) {
  const analysisJson = safeJsonParse(row.analysis_json);
  const parsedImages = safeJsonParse(row.images_json);
  const images = Array.isArray(parsedImages)
    ? parsedImages.filter(Boolean)
    : [];

  if (images.length === 0 && (row.image_url || row.image_data)) {
    images.push({
      image_url: row.image_url,
      image_path: row.image_path,
      image_mime_type: row.image_mime_type,
      image_size: row.image_size
    });
  }

  return {
    id: row.id,
    user_id: row.user_id,
    user_name: row.user_name,
    defect_type: row.defect_type,
    severity_score: row.severity_score,
    estimated_repair_cost: row.estimated_repair_cost,
    expected_processing_days: row.expected_processing_days,
    actual_processing_days: row.actual_processing_days,
    analysis_result: row.analysis_text,
    analysis_json: analysisJson,
    image_data: row.image_data,
    image_url: row.image_url,
    image_path: row.image_path,
    image_mime_type: row.image_mime_type,
    image_size: row.image_size,
    images,
    location: row.location,
    address: row.address,
    space_type: row.space_type,
    defect_area: row.defect_area,
    user_description: row.user_description,
    urgency: row.urgency,
    contact_phone: row.contact_phone,
    status: row.status,
    received_at: row.received_at,
    processed_at: row.processed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// --- API 경로 시작 ---

// [기능 1] 회원가입 API (기본 role은 'user')
app.post('/api/signup', async (req, res) => {
  const { userid, password, name } = req.body;
  const missing = validateRequiredFields({ userid, password, name });

  if (missing.length > 0) {
    return res.status(400).json({ error: '아이디, 비밀번호, 이름을 모두 입력해 주세요.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = "INSERT INTO users (userid, password, name, role) VALUES (?, ?, ?, 'user')";

    db.execute(query, [userid, hashedPassword, name], (err) => {
      if (err) {
        return res.status(500).json({ error: '아이디 중복 또는 DB 오류' });
      }

      res.json({ success: true, message: '회원가입이 완료되었습니다.' });
    });
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

// [기능 2] 로그인 API (role 정보 포함)
app.post('/api/login', (req, res) => {
  const { userid, password } = req.body;
  const missing = validateRequiredFields({ userid, password });

  if (missing.length > 0) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' });
  }

  const query = 'SELECT * FROM users WHERE userid = ?';

  db.execute(query, [userid], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: '비밀번호가 일치하지 않습니다.' });
    }

    const token = jwt.sign(
      { id: user.id, userid: user.userid, role: user.role },
      SECRET_KEY,
      { expiresIn: '1d' }
    );

    res.json({
      success: true,
      token,
      name: user.name,
      id: user.id,
      role: user.role
    });
  });
});

// [기능 3] AI 채팅 API
// [개선] 자유 텍스트 대신 JSON 구조 응답을 받고, 화면용 텍스트도 함께 생성
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { messages = [], image } = req.body;

    const systemPrompt = [
      '당신은 건설 하자 민원 분석 전문가입니다.',
      '반드시 하나의 JSON 객체만 응답하세요. 설명 문장, 코드블록, 마크다운은 금지입니다.',
      'JSON 형식은 아래 키를 정확히 사용하세요.',
      '{',
      '  "defectContent": "string",',
      '  "severityScore": 1,',
      '  "expectedSolution": "string",',
      '  "processingMethod": "string",',
      '  "relatedLaws": "string"',
      '}',
      'severityScore는 1~10 정수로 반환하세요.',
      '이미지와 질문을 함께 보고 가장 가능성 높은 값을 채우세요.'
    ].join('\n');

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    if (image && apiMessages.length > 1) {
      const lastIdx = apiMessages.length - 1;
      const originalText = apiMessages[lastIdx].content;
      apiMessages[lastIdx].content = [
        { type: 'text', text: originalText },
        { type: 'image_url', image_url: { url: image } }
      ];
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: apiMessages,
      max_tokens: 1000
    });

    const rawContent = completion.choices[0]?.message?.content;
    const parsedContent = extractAssistantJson(rawContent);
    const structuredResult = normalizeAnalysisPayload(parsedContent);
    const result = buildAnalysisText(structuredResult);

    res.json({
      result,
      structuredResult
    });
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
  }
});

// [기능 4] 하자 민원 접수 데이터 저장 API
// [개선] 분석 결과는 컬럼별로 저장하고, 이미지는 파일로 저장한 뒤 경로만 DB에 보관
// 민원 접수는 분석 JSON과 여러 장의 사진을 함께 받아 reports/report_images에 나눠 저장한다.
app.post('/api/register-report', authenticateToken, upload.array('images', 10), requireSelfOrAdmin, async (req, res) => {
  const {
    user_id,
    analysis_result,
    analysis_text,
    structured_analysis,
    location,
    address,
    space_type,
    defect_area,
    user_description,
    urgency,
    contact_phone,
  } = req.body;

  const missingComplaintFields = validateRequiredFields({
    location,
    defect_area,
    user_description,
    contact_phone
  });

  if (missingComplaintFields.length > 0) {
    return res.status(400).json({ error: '현장 위치, 하자 발생 부위, 사용자 설명, 연락처를 입력해 주세요.' });
  }

  const imageFiles = req.files || [];
  if (imageFiles.length === 0) {
    return res.status(400).json({ error: '민원 접수를 위한 하자 사진이 필요합니다.' });
  }

  const parsedStructuredAnalysis = parseStructuredAnalysis(structured_analysis);
  if (!parsedStructuredAnalysis) {
    return res.status(400).json({ error: 'AI 분석 결과 JSON이 필요합니다.' });
  }

  const normalizedStructured = normalizeAnalysisPayload(parsedStructuredAnalysis);
  const analysisError = validateAnalysisPayload(normalizedStructured);
  if (analysisError) {
    return res.status(400).json({ error: analysisError });
  }

  const finalAnalysisText = analysis_text || analysis_result || buildAnalysisText(normalizedStructured);

  const reportUserId = req.user.role === 'admin' ? Number(user_id) : req.user.id;

  if (!Number.isInteger(reportUserId)) {
    return res.status(400).json({ error: '유효한 사용자 정보가 필요합니다.' });
  }

  let storedImages = [];

  try {
    storedImages = await Promise.all(imageFiles.map((file) => processReportImage(file)));
    const primaryImage = storedImages[0];
    const defectType = toColumnText(normalizedStructured.defectContent, 255) || '미분류';

    const query = `
      INSERT INTO reports (
        user_id,
        defect_type,
        severity_score,
        estimated_repair_cost,
        expected_processing_days,
        actual_processing_days,
        analysis_text,
        analysis_json,
        image_url,
        image_path,
        image_mime_type,
        image_size,
        location,
        address,
        space_type,
        defect_area,
        user_description,
        urgency,
        contact_phone,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      reportUserId,
      defectType,
      normalizedStructured.severityScore,
      null,
      null,
      null,
      finalAnalysisText,
      JSON.stringify(normalizedStructured),
      primaryImage.imageUrl,
      primaryImage.imagePath,
      primaryImage.mimeType,
      primaryImage.size,
      toColumnText(location, 255),
      toColumnText(address, 500),
      toColumnText(space_type, 100),
      toColumnText(defect_area, 255),
      toNullableText(user_description),
      toColumnText(urgency, 50) || '보통',
      toColumnText(contact_phone, 50),
      REPORT_STATUS.RECEIVED
    ];

    db.execute(query, params, (err, result) => {
      if (err) {
        storedImages.forEach((image) => fs.promises.unlink(path.join(__dirname, image.imagePath)).catch(() => {}));
        return res.status(500).json({ error: 'DB 저장 실패', detail: err.message });
      }

      const historyQuery = `
        INSERT INTO report_status_history (report_id, status, changed_by, note)
        VALUES (?, ?, ?, ?)
      `;

      const imageRows = storedImages.map((image, index) => [
        result.insertId,
        image.imageUrl,
        image.imagePath,
        image.mimeType,
        image.size,
        image.width,
        image.height,
        index
      ]);

      const imageQuery = `
        INSERT INTO report_images (
          report_id,
          image_url,
          image_path,
          image_mime_type,
          image_size,
          width,
          height,
          sort_order
        ) VALUES ?
      `;

      db.query(imageQuery, [imageRows], (imageErr) => {
        if (imageErr) {
          storedImages.forEach((image) => fs.promises.unlink(path.join(__dirname, image.imagePath)).catch(() => {}));
          return res.status(500).json({ error: '이미지 정보 저장 실패', detail: imageErr.message });
        }

        db.execute(historyQuery, [result.insertId, REPORT_STATUS.RECEIVED, reportUserId, '신고 최초 접수'], (historyErr) => {
          if (historyErr) {
            return res.status(500).json({ error: '상태 이력 저장 실패', detail: historyErr.message });
          }

          res.json({
            success: true,
            reportId: result.insertId,
            image_url: primaryImage.imageUrl,
            images: storedImages.map((image) => ({ image_url: image.imageUrl }))
          });
        });
      });
    });
  } catch (error) {
    storedImages.forEach((image) => fs.promises.unlink(path.join(__dirname, image.imagePath)).catch(() => {}));
    res.status(500).json({ error: '이미지 저장 실패', detail: error.message });
  }
});

// [기능 5] 내 민원 접수 내역 조회 API
// [개선] 구조화된 분석 컬럼과 JSON 데이터를 함께 조회
app.get('/api/my-reports/:user_id', authenticateToken, requireSelfOrAdmin, (req, res) => {
  const userId = req.params.user_id;
  const query = `
    SELECT
      id,
      user_id,
      defect_type,
      severity_score,
      estimated_repair_cost,
      expected_processing_days,
      actual_processing_days,
      analysis_text,
      analysis_json,
      image_data,
      image_url,
      image_path,
      image_mime_type,
      image_size,
      location,
      address,
      space_type,
      defect_area,
      user_description,
      urgency,
      contact_phone,
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', ri.id,
            'image_url', ri.image_url,
            'image_path', ri.image_path,
            'image_mime_type', ri.image_mime_type,
            'image_size', ri.image_size,
            'width', ri.width,
            'height', ri.height,
            'sort_order', ri.sort_order
          )
        )
        FROM report_images ri
        WHERE ri.report_id = reports.id
      ) AS images_json,
      status,
      received_at,
      processed_at,
      created_at,
      updated_at
    FROM reports
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.execute(query, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: '목록 조회 실패' });
    }

    res.json(results.map(formatReportRow));
  });
});

// [기능 6] 관리자 전체 민원 내역 조회 API
app.get('/api/admin/all-reports', authenticateToken, requireAdmin, (req, res) => {
  const query = `
    SELECT
      r.id,
      r.user_id,
      r.defect_type,
      r.severity_score,
      r.estimated_repair_cost,
      r.expected_processing_days,
      r.actual_processing_days,
      r.analysis_text,
      r.analysis_json,
      r.image_data,
      r.image_url,
      r.image_path,
      r.image_mime_type,
      r.image_size,
      r.location,
      r.address,
      r.space_type,
      r.defect_area,
      r.user_description,
      r.urgency,
      r.contact_phone,
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', ri.id,
            'image_url', ri.image_url,
            'image_path', ri.image_path,
            'image_mime_type', ri.image_mime_type,
            'image_size', ri.image_size,
            'width', ri.width,
            'height', ri.height,
            'sort_order', ri.sort_order
          )
        )
        FROM report_images ri
        WHERE ri.report_id = r.id
      ) AS images_json,
      r.status,
      r.received_at,
      r.processed_at,
      r.created_at,
      r.updated_at,
      u.name AS user_name
    FROM reports r
    JOIN users u ON r.user_id = u.id
    ORDER BY r.created_at DESC
  `;

  db.execute(query, (err, results) => {
    if (err) {
      return res.status(500).json({ error: '전체 목록 조회 실패' });
    }

    res.json(results.map(formatReportRow));
  });
});

// [기능] 민원 삭제 API
// 사용자는 본인이 접수한 민원만 삭제할 수 있고, 관리자는 전체 민원을 삭제할 수 있다.
app.delete('/api/reports/:id', authenticateToken, (req, res) => {
  const reportId = Number(req.params.id);

  if (!Number.isInteger(reportId)) {
    return res.status(400).json({ error: '유효한 민원 번호가 필요합니다.' });
  }

  const selectQuery = `
    SELECT
      r.id,
      r.user_id,
      r.image_path,
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT('image_path', ri.image_path)
        )
        FROM report_images ri
        WHERE ri.report_id = r.id
      ) AS images_json
    FROM reports r
    WHERE r.id = ?
    LIMIT 1
  `;

  db.execute(selectQuery, [reportId], (selectErr, rows) => {
    if (selectErr) {
      return res.status(500).json({ error: '민원 조회 실패', detail: selectErr.message });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: '삭제할 민원을 찾을 수 없습니다.' });
    }

    const report = rows[0];
    if (req.user.role !== 'admin' && req.user.id !== report.user_id) {
      return res.status(403).json({ error: '본인이 접수한 민원만 삭제할 수 있습니다.' });
    }

    const images = safeJsonParse(report.images_json);
    const imagePaths = Array.isArray(images)
      ? images.map((image) => image.image_path).filter(Boolean)
      : [];

    if (report.image_path) {
      imagePaths.push(report.image_path);
    }

    db.execute('DELETE FROM reports WHERE id = ?', [reportId], (deleteErr) => {
      if (deleteErr) {
        return res.status(500).json({ error: '민원 삭제 실패', detail: deleteErr.message });
      }

      [...new Set(imagePaths)].forEach((imagePath) => {
        const resolvedPath = path.resolve(__dirname, imagePath);
        if (resolvedPath.startsWith(REPORT_UPLOAD_DIR)) {
          fs.promises.unlink(resolvedPath).catch(() => {});
        }
      });

      return res.json({ success: true, message: '민원이 삭제되었습니다.' });
    });
  });
});

// [기능 7] 관리자 하자 처리 상태 업데이트 API
// [개선] 처리 완료 시 처리일자/실제 처리기간을 함께 갱신하고 이력도 저장
app.put('/api/report-status/:id', authenticateToken, requireAdmin, (req, res) => {
  const reportId = req.params.id;
  const { status, changed_by = req.user.id, note = null } = req.body;

  const normalizedStatus = status || REPORT_STATUS.IN_REVIEW;
  if (!ALLOWED_REPORT_STATUSES.includes(normalizedStatus)) {
    return res.status(400).json({
      error: '허용되지 않는 상태값입니다.',
      allowedStatuses: ALLOWED_REPORT_STATUSES
    });
  }

  const isCompleted = normalizedStatus === REPORT_STATUS.COMPLETED;

  const query = `
    UPDATE reports
    SET
      status = ?,
      processed_at = CASE WHEN ? THEN NOW() ELSE processed_at END,
      actual_processing_days = CASE
        WHEN ? THEN DATEDIFF(NOW(), received_at)
        ELSE actual_processing_days
      END
    WHERE id = ?
  `;

  db.execute(query, [normalizedStatus, isCompleted, isCompleted, reportId], (err, result) => {
    if (err) {
      return res.status(500).json({ error: '상태 업데이트 실패', detail: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '해당 민원을 찾을 수 없습니다.' });
    }

    const historyQuery = `
      INSERT INTO report_status_history (report_id, status, changed_by, note)
      VALUES (?, ?, ?, ?)
    `;

    db.execute(historyQuery, [reportId, normalizedStatus, changed_by, note], (historyErr) => {
      if (historyErr) {
        return res.status(500).json({ error: '상태 이력 저장 실패', detail: historyErr.message });
      }

      res.json({ success: true, message: '상태가 변경되었습니다.' });
    });
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? '이미지 파일은 10MB 이하만 업로드할 수 있습니다.'
      : '이미지 업로드 중 오류가 발생했습니다.';
    return res.status(400).json({ error: message });
  }

  if (err?.message === '이미지 파일만 업로드할 수 있습니다.') {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
