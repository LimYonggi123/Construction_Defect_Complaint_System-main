# 학습된 YOLOv8-seg 모델(.pt) 을 ONNX(.onnx) 로 변환.
# 학습 직후 한 번만 실행하면 됨. 그 이후로는 Python 불필요.
# 사용법:
#   python export_onnx.py [모델경로(.pt)] [출력경로(.onnx)]
#   기본: ./runs/defect_seg/weights/best.pt → ./models/best.onnx

import sys
import shutil
from pathlib import Path


def main():
    pt_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("./runs/defect_seg/weights/best.pt")
    onnx_target = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("./models/best.onnx")

    if not pt_path.exists():
        print(f"오류: 모델 파일 없음: {pt_path}")
        sys.exit(1)

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics 가 필요합니다. pip install -r requirements.txt")
        sys.exit(1)

    print(f"[export] 입력 모델: {pt_path}")
    model = YOLO(str(pt_path))

    # opset 12: onnxruntime-node 와 안정적으로 호환
    # dynamic=False: 입력 크기 고정 (640x640). detect.js 전제와 일치
    exported = model.export(
        format="onnx",
        opset=12,
        simplify=True,
        dynamic=False,
        imgsz=640,
    )

    exported_path = Path(exported)
    print(f"[export] ultralytics 가 저장한 경로: {exported_path}")

    onnx_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported_path, onnx_target)
    print(f"[export] 복사 완료: {onnx_target.resolve()}")
    print()
    print("AIserver.js 가 이 경로(또는 .env 의 YOLO_MODEL_PATH) 를 사용합니다.")


if __name__ == "__main__":
    main()
