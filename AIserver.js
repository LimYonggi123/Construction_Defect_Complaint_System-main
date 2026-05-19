// YOLOv8-seg ONNX 기반 건설 하자 AI 분석 서버.
// 실행:  node AIserver.js  (기본 포트 4000)

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

// 환경 설정 
const YOLO_MODEL_PATH =
  process.env.YOLO_MODEL_PATH ||
  path.join(__dirname, 'ai', 'models', 'best.onnx');

const TMP_UPLOAD_DIR = path.join(__dirname, 'uploads', 'ai-temp');
fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });

//미들웨어
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

//OpenAI
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

//multer (이미지 업로드)
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


// 보조 함수

function buildDetectionText(yoloResult) {
  const { detections, summary, image_size } = yoloResult;
  if (!detections || detections.length === 0) {
    return '[YOLO 탐지 결과 없음. 본 모델은 소규모 데이터로 학습된 보조 분류기일 뿐임. 사진을 직접 면밀히 검토하여 진단할 것. 천장 얼룩, 변색, 균열, 누수 자국, 곰팡이 등 시각적 단서를 적극적으로 찾을 것.]';
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

async function generateDiagnosis(detectionText, userMessage = '', imagePath = null) {
  const hasImage = !!imagePath;

  const systemPrompt = [
    '당신은 건설 하자 진단 전문가다.',
    '입력: 1) YOLO 자동탐지 텍스트(매우 약한 보조 신호), 2) 원본 사진(주요 판단 근거).',
    '⚠️ 절대 규칙: YOLO 가 "탐지 0건" 이라고 보고해도 그것을 신뢰하지 말 것. 사진을 직접 보고 판단하라.',
    '사진에서 다음 중 하나라도 시각적으로 보이면 적극적으로 진단하라:',
    '- 천장/벽의 변색, 얼룩, 누런 자국 → 누수 흔적',
    '- 검은 점이나 패턴 → 곰팡이',
    '- 표면 갈라짐(선/금) → 균열',
    '- 표면 박리/벗겨짐 → 마감재 손상',
    '⚠️ 균열 vs 누수 구분:',
    '- 균열(Crack): 선/금/갈라짐. 회색/흰색 직선이나 거미줄 패턴. 모양이 선이다.',
    '- 누수(leak): 갈색/노란색/주황색 얼룩, 변색된 면. 모양이 면적이다.',
    '- 색과 형태로 명확히 구분: 선 = 균열, 컬러 얼룩 = 누수.',
    '⚠️ severityScore 부여 규칙:',
    '- 사진에 어떤 형태의 이상(얼룩/변색/누런 자국 포함)이라도 보이면 절대 1 이하 부여 금지.',
    '- 명확한 누수/균열/곰팡이 → 5-8',
    '- 의심 단서 → 3-4',
    '- 정말 깨끗한 새 벽/천장이라고 100% 확신할 때만 → 1-2',
    '반드시 하나의 JSON 객체만 응답. 마크다운/코드블록 금지.',
    '{',
    '  "defectContent": "...",',
    '  "severityScore": 1~10 정수,',
    '  "expectedSolution": "...",',
    '  "processingMethod": "...",',
    '  "relatedLaws": "..."',
    '}',
  ].join('\n');

  const userText = [
    detectionText,
    userMessage ? `\n[사용자 추가 설명]\n${userMessage}` : '',
  ].join('\n');

  let userContent;
  if (hasImage) {
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');
    userContent = [
      { type: 'text', text: userText },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
    ];
  } else {
    userContent = userText;
  }

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

// API 라우트

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

    // YOLO 추론
    const yoloResult = await detect(YOLO_MODEL_PATH, tmpPath);
    const detectionText = buildDetectionText(yoloResult);

    // GPT-4o 진단
    const userMessage = req.body.message || '';
    const diagnosis = await generateDiagnosis(detectionText, userMessage, tmpPath);

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
    const diagnosis = await generateDiagnosis(detectionText, message || '', resolved);
    res.json({ success: true, yolo: yoloResult, detectionText, diagnosis });
  } catch (err) {
    console.error('[AIserver] analyze-path 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

//에러 핸들러
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