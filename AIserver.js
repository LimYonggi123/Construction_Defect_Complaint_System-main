// ===========================================================
// AIserver.js
// YOLOv8-seg ONNX 기반 건설 하자 AI 분석 서버.
// onnxruntime-node 로 직접 추론 (Python 호출 없음).
// server.js (포트 3000) 와 독립적으로 동작.
// 실행:  node AIserver.js  (기본 포트 4000)
// ===========================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
require('dotenv').config();

const { detect } = require('./ai/detect.js');

const app = express();
const PORT = process.env.AI_PORT || 4000;

// ---- 환경 설정 -----------------------------------------------
const YOLO_MODEL_PATH =
  process.env.YOLO_MODEL_PATH ||
  path.join(__dirname, 'ai', 'models', 'best.onnx');

const TMP_UPLOAD_DIR = path.join(__dirname, 'uploads', 'ai-temp');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

// ---- 미들웨어 ------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---- OpenAI (기존 .env 그대로 재사용) ------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const KOREAN_LABELS = {
  Crack: '균열',
  leak: '누수',
  tile: '타일 손상',
};

// ---- multer (이미지 업로드) ----------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
    cb(null, true);
  },
});

// ===========================================================
// 보조 함수
// ===========================================================

function buildDetectionText(yoloResult) {
  const { detections, summary, image_size } = yoloResult;
  if (!detections || detections.length === 0) {
    return '[YOLO 결과] 사진에서 학습된 하자 유형(균열/누수/타일)이 탐지되지 않았습니다.';
  }

  const classSummary = Object.entries(summary.class_counts)
    .map(([cls, count]) => `${KOREAN_LABELS[cls] || cls}(${cls}) ${count}개`)
    .join(', ');

  const details = detections.map((d, i) => {
    const ko = KOREAN_LABELS[d.class] || d.class;
    const area = d.mask_area_ratio !== undefined ? `, 영역 비율 ${d.mask_area_ratio}%` : '';
    return `  ${i + 1}) ${ko}(${d.class}) 신뢰도 ${(d.confidence * 100).toFixed(1)}%${area}`;
  }).join('\n');

  return [
    '[YOLO 세그멘테이션 결과]',
    `- 이미지 크기: ${image_size.width} x ${image_size.height}`,
    `- 탐지 요약: 총 ${summary.total_count}건 (${classSummary})`,
    '- 상세:',
    details,
  ].join('\n');
}

async function generateDiagnosis(detectionText, userMessage = '') {
  const systemPrompt = [
  '당신은 건설 하자 진단 전문가다.',
  '입력: 1) YOLO 자동탐지 텍스트(보조 정보), 2) 원본 사진(주요 판단 근거).',
  '⚠️ YOLO는 매우 소규모 데이터로 학습된 보조 분류기일 뿐이다. YOLO가 "탐지 0건"이라고 해도 그것을 신뢰하지 말고 사진을 직접 보고 판단하라.',
  '사진에서 다음 중 하나라도 보이면 적극적으로 진단하라: 균열, 누수 자국, 천장/벽 얼룩, 페인트 박리, 곰팡이, 변색, 타일 손상, 마감재 들뜸, 누수 흔적.',
  'severityScore는 반드시 1~10 사이의 정수. 사진에서 어떤 이상이라도 발견되면 절대 0을 반환하지 말 것. 정말 깨끗하면 1.',
  '반드시 하나의 JSON 객체만 응답한다. 코드블록/마크다운/설명 문장 금지.',
  '{',
  '  "defectContent": "...",',
  '  "severityScore": 1~10 정수,',
  '  "expectedSolution": "...",',
  '  "processingMethod": "...",',
  '  "relatedLaws": "..."',
  '}',
].join('\n');

  const userContent = [
    detectionText,
    userMessage ? `\n[사용자 추가 설명]\n${userMessage}` : '',
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: 1000,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

// ===========================================================
// API 라우트
// ===========================================================

// 헬스체크
app.get('/api/ai/health', (req, res) => {
  const modelExists = fs.existsSync(YOLO_MODEL_PATH);
  res.json({
    status: 'ok',
    port: PORT,
    model_path: YOLO_MODEL_PATH,
    model_loaded: modelExists,
    runtime: 'onnxruntime-node',
  });
});

// 메인 분석 API
app.post('/api/ai/analyze-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });

  const filename = `${Date.now()}-${crypto.randomUUID()}.jpg`;
  const tmpPath = path.join(TMP_UPLOAD_DIR, filename);

  try {
    // 회전 보정 + 리사이즈 후 임시 저장 (디스크 경로로 detect 에 전달)
    await sharp(req.file.buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(tmpPath);

    // YOLO 추론 (onnxruntime-node)
    const yoloResult = await detect(YOLO_MODEL_PATH, tmpPath);
    const detectionText = buildDetectionText(yoloResult);

    // GPT-4o 진단
    const userMessage = req.body.message || '';
    const diagnosis = await generateDiagnosis(detectionText, userMessage);

    res.json({
      success: true,
      yolo: yoloResult,
      detectionText,
      diagnosis,
    });
  } catch (err) {
    console.error('[AIserver] analyze-image 오류:', err);
    res.status(500).json({ error: err.message });
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {});
  }
});

// 디스크에 이미 저장된 이미지 경로로 분석 (server.js 가 저장한 사진 재분석용)
app.post('/api/ai/analyze-path', async (req, res) => {
  const { imagePath, message } = req.body || {};
  if (!imagePath) return res.status(400).json({ error: 'imagePath가 필요합니다.' });

  const resolved = path.resolve(__dirname, imagePath);
  if (!resolved.startsWith(__dirname)) {
    return res.status(400).json({ error: '허용되지 않은 경로입니다.' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: '이미지 파일을 찾을 수 없습니다.' });
  }

  try {
    const yoloResult = await detect(YOLO_MODEL_PATH, resolved);
    const detectionText = buildDetectionText(yoloResult);
    const diagnosis = await generateDiagnosis(detectionText, message || '');
    res.json({ success: true, yolo: yoloResult, detectionText, diagnosis });
  } catch (err) {
    console.error('[AIserver] analyze-path 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- 에러 핸들러 ---------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? '이미지 파일은 10MB 이하만 업로드할 수 있습니다.'
      : '이미지 업로드 중 오류가 발생했습니다.';
    return res.status(400).json({ error: msg });
  }
  if (err?.message === '이미지 파일만 업로드 가능합니다.') {
    return res.status(400).json({ error: err.message });
  }
  console.error('[AIserver] 처리되지 않은 오류:', err);
  return res.status(500).json({ error: err.message || '서버 오류' });
});

app.listen(PORT, () => {
  console.log(`[AIserver] running at http://localhost:${PORT}`);
  console.log(`[AIserver] runtime: onnxruntime-node`);
  console.log(`[AIserver] model:   ${YOLO_MODEL_PATH}`);
});