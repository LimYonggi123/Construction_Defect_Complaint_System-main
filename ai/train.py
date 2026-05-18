# ============================================================
# ai/train.py
# YOLOv8-seg 모델 학습 스크립트.
# 데이터셋(Object_Detection_v7i_yolov8.zip) 압축 해제 후 사용.
#
# 폴더 구조 (이 파일 기준):
#   ai/
#     train.py
#     data.yaml
#     dataset/
#       train/images, train/labels
#       test/images,  test/labels
#       (valid 가 없으면 data.yaml 에서 val 을 test 로 지정)
#
# 사용법:
#   cd ai
#   python train.py                          # 기본 (50 epoch, yolov8n-seg)
#   python train.py --epochs 100 --batch 8   # 옵션 변경
#
# 학습 완료 후 ./runs/defect_seg/weights/best.pt 가 생성됨.
# 이 파일을 ai/models/best.pt 로 복사하거나 env 변수 YOLO_MODEL_PATH 로 경로 지정.
# ============================================================

import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="YOLOv8-seg 건설 하자 탐지 모델 학습")
    parser.add_argument("--data", default="./data.yaml", help="데이터셋 yaml 경로")
    parser.add_argument("--model", default="yolov8n-seg.pt",
                        help="사전 학습 가중치 (n/s/m/l/x). 기본 yolov8n-seg (가장 가벼움)")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--project", default="./runs")
    parser.add_argument("--name", default="defect_seg")
    parser.add_argument("--device", default="", help="'cpu' 또는 '0' (GPU). 비우면 자동")
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("ultralytics 패키지가 필요합니다. 'pip install -r requirements.txt' 로 설치하세요.")

    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(f"data.yaml 을 찾을 수 없습니다: {data_path.resolve()}")

    print(f"[train] 사전 학습 가중치: {args.model}")
    print(f"[train] 데이터셋:        {data_path.resolve()}")
    print(f"[train] epochs={args.epochs}, batch={args.batch}, imgsz={args.imgsz}")

    model = YOLO(args.model)
    train_kwargs = dict(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        exist_ok=True,
    )
    if args.device:
        train_kwargs["device"] = args.device

    model.train(**train_kwargs)

    best = Path(args.project) / args.name / "weights" / "best.pt"
    print()
    print("=" * 60)
    print("학습 완료.")
    if best.exists():
        print(f"가장 좋은 모델: {best.resolve()}")
        print("이 파일을 ai/models/best.pt 로 복사하거나")
        print(".env 에 YOLO_MODEL_PATH 를 위 경로로 설정하세요.")
    print("=" * 60)


if __name__ == "__main__":
    main()
