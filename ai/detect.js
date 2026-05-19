// YOLOv8 ONNX 모델을 onnxruntime-node 로 직접 추론.
// Detection / Segmentation 두 가지 모델 모두 자동 감지하여 처리.

const ort = require('onnxruntime-node');
const sharp = require('sharp');

const INPUT_SIZE = 640;
const PROTO_SIZE = 160;
const NUM_MASK_COEFFS = 32;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.5;
const MASK_THRESHOLD = 0.5;

const CLASS_NAMES = ['Crack', 'leak', 'tile'];

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

async function letterbox(imagePath) {
  const image = sharp(imagePath).rotate();
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
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  return { raw, ratio, padLeft, padTop, origW, origH };
}

function preprocess(rawBuffer) {
  const total = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(3 * total);
  for (let i = 0; i < total; i++) {
    data[i]             = rawBuffer[i * 3]     / 255;
    data[i + total]     = rawBuffer[i * 3 + 1] / 255;
    data[i + 2 * total] = rawBuffer[i * 3 + 2] / 255;
  }
  return data;
}

function decodeOutputs(output0, nc, hasMask) {
  const anchors = output0.dims[2];
  const data = output0.data;

  const detections = [];
  for (let a = 0; a < anchors; a++) {
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

    const cx = data[0 * anchors + a];
    const cy = data[1 * anchors + a];
    const w  = data[2 * anchors + a];
    const h  = data[3 * anchors + a];
    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;

    let maskCoeffs = null;
    if (hasMask) {
      maskCoeffs = new Float32Array(NUM_MASK_COEFFS);
      for (let m = 0; m < NUM_MASK_COEFFS; m++) {
        maskCoeffs[m] = data[(4 + nc + m) * anchors + a];
      }
    }

    detections.push({ x1, y1, x2, y2, score: bestScore, cls: bestCls, maskCoeffs });
  }
  return detections;
}

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

function generateMask(maskCoeffs, protoData) {
  const planeSize = PROTO_SIZE * PROTO_SIZE;
  const mask = new Float32Array(planeSize);

  for (let p = 0; p < planeSize; p++) {
    let sum = 0;
    for (let k = 0; k < NUM_MASK_COEFFS; k++) {
      sum += maskCoeffs[k] * protoData[k * planeSize + p];
    }
    mask[p] = 1 / (1 + Math.exp(-sum));
  }
  return mask;
}

function computeMaskStats(mask, bbox640) {
  const scale = PROTO_SIZE / INPUT_SIZE;
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

  let globalMaskCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > MASK_THRESHOLD) globalMaskCount++;
  }

  return {
    bbox_fill_ratio: bboxTotal > 0 ? bboxMaskCount / bboxTotal : 0,
    global_ratio: globalMaskCount / mask.length,
  };
}

async function detect(modelPath, imagePath) {
  const session = await getSession(modelPath);

  const { raw, ratio, padLeft, padTop, origW, origH } = await letterbox(imagePath);
  const inputData = preprocess(raw);

  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const feeds = { [session.inputNames[0]]: inputTensor };
  const outputs = await session.run(feeds);

  const output0 = outputs[session.outputNames[0]];

  //////// 핵심: output1 존재 여부로 모델 종류 자동 감지 ////////
  const output1 = session.outputNames.length > 1
    ? outputs[session.outputNames[1]]
    : null;
  const hasMask = !!output1;

  const nc = hasMask
    ? output0.dims[1] - 4 - NUM_MASK_COEFFS
    : output0.dims[1] - 4;
  //////// 자동 감지 끝 ////////

  let detections = decodeOutputs(output0, nc, hasMask);
  detections = nms(detections);

  const protoData = hasMask ? output1.data : null;
  const results = [];

  for (const d of detections) {
    let maskAreaRatio = null;
    let bboxFillRatio = null;
    if (hasMask && d.maskCoeffs) {
      const mask = generateMask(d.maskCoeffs, protoData);
      const stats = computeMaskStats(mask, d);
      maskAreaRatio = round(stats.global_ratio * 100, 2);
      bboxFillRatio = round(stats.bbox_fill_ratio * 100, 2);
    }

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
      mask_area_ratio: maskAreaRatio,
      bbox_fill_ratio: bboxFillRatio,
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