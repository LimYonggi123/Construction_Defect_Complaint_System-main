// ============================================================
// ai/detect.js
// YOLOv8-seg ONNX 모델을 onnxruntime-node 로 직접 추론.
// Python 호출 없음. 학습 후 best.onnx 만 있으면 동작.
//
// YOLOv8-seg ONNX 출력:
//   output0: [1, 4 + nc + 32, 8400]  ← bbox(xywh) + class scores + mask coeffs
//   output1: [1, 32, 160, 160]       ← prototype masks
//
// 후처리: confidence threshold → NMS → proto×coeffs sigmoid → mask area
// ============================================================

const ort = require('onnxruntime-node');
const sharp = require('sharp');

// ---- 하이퍼파라미터 ------------------------------------------
const INPUT_SIZE = 640;          // YOLOv8 학습 시 imgsz 와 동일하게
const PROTO_SIZE = 160;          // YOLOv8-seg 의 proto 해상도 (= INPUT_SIZE / 4)
const NUM_MASK_COEFFS = 32;      // YOLOv8-seg 표준
const CONF_THRESHOLD = 0.05;
const IOU_THRESHOLD = 0.5;
const MASK_THRESHOLD = 0.5;

// data.yaml 의 names 배열과 동일한 순서로 작성
const CLASS_NAMES = ['Crack', 'leak', 'tile'];

// ---- ONNX 세션 캐시 (첫 호출 후 재사용) ----------------------
let cachedSession = null;
let cachedPath = null;

async function getSession(modelPath) {
  if (cachedSession && cachedPath === modelPath) return cachedSession;
  cachedSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  cachedPath = modelPath;
  return cachedSession;
}

// ============================================================
// 1) 전처리: letterbox 리사이즈 + RGB CHW Float32
// ============================================================

async function letterbox(imagePath) {
  const image = sharp(imagePath).rotate(); // EXIF 회전 보정
  const meta = await image.metadata();
  const origW = meta.width;
  const origH = meta.height;

  const ratio = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * ratio);
  const newH = Math.round(origH * ratio);
  const padW = INPUT_SIZE - newW;
  const padH = INPUT_SIZE - newH;
  const padLeft = Math.floor(padW / 2);
  const padTop = Math.floor(padH / 2);

  const raw = await image
    .resize(newW, newH, { fit: 'fill' })
    .extend({
      top: padTop,
      bottom: padH - padTop,
      left: padLeft,
      right: padW - padLeft,
      background: { r: 114, g: 114, b: 114 }, // ultralytics 와 동일한 padding 색
    })
    .removeAlpha()
    .raw()
    .toBuffer(); // HWC RGB, 640*640*3 bytes

  return { raw, ratio, padLeft, padTop, origW, origH };
}

function preprocess(rawBuffer) {
  // HWC RGB → CHW float32 (/255)
  const total = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(3 * total);
  for (let i = 0; i < total; i++) {
    data[i]             = rawBuffer[i * 3]     / 255; // R
    data[i + total]     = rawBuffer[i * 3 + 1] / 255; // G
    data[i + 2 * total] = rawBuffer[i * 3 + 2] / 255; // B
  }
  return data;
}

// ============================================================
// 2) 출력 디코딩: bbox + class score + mask coeffs 추출
// ============================================================

function decodeOutputs(output0, nc) {
  // output0.dims: [1, 4 + nc + 32, 8400]
  // 데이터는 row-major: data[c * anchors + a]
  const channels = output0.dims[1];
  const anchors = output0.dims[2];
  const data = output0.data;

  const detections = [];
  for (let a = 0; a < anchors; a++) {
    // 최고 점수 클래스 찾기
    let bestCls = -1;
    let bestScore = 0;
    for (let c = 0; c < nc; c++) {
      const score = data[(4 + c) * anchors + a];
      if (score > bestScore) {
        bestScore = score;
        bestCls = c;
      }
    }
    if (bestScore < CONF_THRESHOLD) continue;

    // bbox (cx, cy, w, h) → (x1, y1, x2, y2)
    const cx = data[0 * anchors + a];
    const cy = data[1 * anchors + a];
    const w  = data[2 * anchors + a];
    const h  = data[3 * anchors + a];
    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;

    // mask coefficients (32개)
    const maskCoeffs = new Float32Array(NUM_MASK_COEFFS);
    for (let m = 0; m < NUM_MASK_COEFFS; m++) {
      maskCoeffs[m] = data[(4 + nc + m) * anchors + a];
    }

    detections.push({ x1, y1, x2, y2, score: bestScore, cls: bestCls, maskCoeffs });
  }
  return detections;
}

// ============================================================
// 3) NMS (클래스별로 따로)
// ============================================================

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function nms(detections) {
  detections.sort((a, b) => b.score - a.score);
  const kept = [];
  const suppressed = new Array(detections.length).fill(false);
  for (let i = 0; i < detections.length; i++) {
    if (suppressed[i]) continue;
    kept.push(detections[i]);
    for (let j = i + 1; j < detections.length; j++) {
      if (suppressed[j]) continue;
      if (detections[i].cls !== detections[j].cls) continue;
      if (iou(detections[i], detections[j]) > IOU_THRESHOLD) {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}

// ============================================================
// 4) 마스크 생성: sigmoid(coeffs @ proto)
// ============================================================

function generateMask(maskCoeffs, protoData) {
  // protoData: Float32Array [32 * 160 * 160]
  // 결과: Float32Array [160 * 160] (sigmoid 적용)
  const mh = PROTO_SIZE;
  const mw = PROTO_SIZE;
  const planeSize = mh * mw;
  const mask = new Float32Array(planeSize);

  for (let p = 0; p < planeSize; p++) {
    let sum = 0;
    for (let k = 0; k < NUM_MASK_COEFFS; k++) {
      sum += maskCoeffs[k] * protoData[k * planeSize + p];
    }
    mask[p] = 1 / (1 + Math.exp(-sum)); // sigmoid
  }
  return mask;
}

function computeMaskStats(mask, bbox640) {
  // bbox 를 160 space 로 변환 → 그 안에서 마스크 픽셀 카운트
  const scale = PROTO_SIZE / INPUT_SIZE; // 0.25
  const bx1 = Math.max(0, Math.floor(bbox640.x1 * scale));
  const by1 = Math.max(0, Math.floor(bbox640.y1 * scale));
  const bx2 = Math.min(PROTO_SIZE, Math.ceil(bbox640.x2 * scale));
  const by2 = Math.min(PROTO_SIZE, Math.ceil(bbox640.y2 * scale));

  let bboxMaskCount = 0;
  let bboxTotal = 0;
  for (let y = by1; y < by2; y++) {
    for (let x = bx1; x < bx2; x++) {
      bboxTotal++;
      if (mask[y * PROTO_SIZE + x] > MASK_THRESHOLD) bboxMaskCount++;
    }
  }

  // 전체 마스크 픽셀 (이미지 대비)
  let globalMaskCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > MASK_THRESHOLD) globalMaskCount++;
  }

  return {
    bbox_fill_ratio: bboxTotal > 0 ? bboxMaskCount / bboxTotal : 0,
    global_ratio: globalMaskCount / mask.length,
  };
}

// ============================================================
// 5) 메인 detect 함수
// ============================================================

async function detect(modelPath, imagePath) {
  const session = await getSession(modelPath);

  // (1) 전처리
  const { raw, ratio, padLeft, padTop, origW, origH } = await letterbox(imagePath);
  const inputData = preprocess(raw);

  // (2) 추론
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const feeds = { [session.inputNames[0]]: inputTensor };
  const outputs = await session.run(feeds);

  const output0 = outputs[session.outputNames[0]]; // detection
  const output1 = outputs[session.outputNames[1]]; // proto masks

  // (3) 디코딩
  const nc = output0.dims[1] - 4 - NUM_MASK_COEFFS;
  let detections = decodeOutputs(output0, nc);

  // (4) NMS
  detections = nms(detections);

  // (5) 각 detection 에 대해 마스크 통계 + 원본 좌표 역변환
  const protoData = output1.data;
  const results = [];

  for (const d of detections) {
    const mask = generateMask(d.maskCoeffs, protoData);
    const stats = computeMaskStats(mask, d);

    // letterbox 역변환 → 원본 이미지 좌표
    const ox1 = Math.max(0, Math.min(origW, (d.x1 - padLeft) / ratio));
    const oy1 = Math.max(0, Math.min(origH, (d.y1 - padTop) / ratio));
    const ox2 = Math.max(0, Math.min(origW, (d.x2 - padLeft) / ratio));
    const oy2 = Math.max(0, Math.min(origH, (d.y2 - padTop) / ratio));

    results.push({
      class: CLASS_NAMES[d.cls] || `class_${d.cls}`,
      confidence: round(d.score, 4),
      bbox: {
        x1: round(ox1, 2),
        y1: round(oy1, 2),
        x2: round(ox2, 2),
        y2: round(oy2, 2),
      },
      // 마스크 면적: 이미지 전체 대비 비율 (%)
      mask_area_ratio: round(stats.global_ratio * 100, 2),
      // bbox 내 마스크 채움 비율 (%)
      bbox_fill_ratio: round(stats.bbox_fill_ratio * 100, 2),
    });
  }

  results.sort((a, b) => b.confidence - a.confidence);

  const classCounts = {};
  for (const r of results) {
    classCounts[r.class] = (classCounts[r.class] || 0) + 1;
  }

  return {
    success: true,
    image_size: { width: origW, height: origH },
    detections: results,
    summary: {
      total_count: results.length,
      class_counts: classCounts,
    },
  };
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

module.exports = { detect, getSession, CLASS_NAMES };