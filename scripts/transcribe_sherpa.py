#!/usr/bin/env python3
"""소리 파일 -> 전사 파일. process.py run 의 --transcriber 로 쓴다.

python -I transcribe_sherpa.py 입력소리 출력.txt
출력은 "[m:ss] 텍스트" 줄이다. process.py 의 load_transcript 가 읽는 형식과 같다.

sherpa-onnx Whisper small(int8) + Silero VAD. 모두 이 컴퓨터에서 돈다.
WHISPER_MODEL_DIR : 모델 폴더 (기본: 저장소의 models/sherpa-onnx-whisper-small)
VAD_MODEL         : silero_vad.onnx (기본: 저장소의 models/silero_vad.onnx)
TRANSCRIBE_LANGUAGE : en | ko | 빈 값(자동)
"""
import os, pathlib, subprocess, sys
import numpy as np
import sherpa_onnx

ROOT = pathlib.Path(__file__).resolve().parent.parent
RATE = 16000


def model_paths():
    model = pathlib.Path(os.environ.get("WHISPER_MODEL_DIR") or ROOT / "models" / "sherpa-onnx-whisper-small")
    vad = pathlib.Path(os.environ.get("VAD_MODEL") or ROOT / "models" / "silero_vad.onnx")
    files = {
        "encoder": model / "small-encoder.int8.onnx",
        "decoder": model / "small-decoder.int8.onnx",
        "tokens": model / "small-tokens.txt",
        "vad": vad,
    }
    missing = [str(p) for p in files.values() if not p.is_file()]
    if missing:
        sys.exit("전사 모델 파일이 없습니다: " + ", ".join(missing))
    return files


def read_samples(audio):
    """ffmpeg 로 16kHz 모노 float32 로 푼다."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", audio, "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


def mmss(sec):
    return f"{sec // 60}:{sec % 60:02d}"


def main(audio, out_path):
    files = model_paths()
    samples = read_samples(audio)
    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(files["encoder"]),
        decoder=str(files["decoder"]),
        tokens=str(files["tokens"]),
        language=os.environ.get("TRANSCRIBE_LANGUAGE", ""),
        task="transcribe",
        num_threads=max(1, (os.cpu_count() or 2) // 2),
    )
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(files["vad"])
    config.silero_vad.min_silence_duration = 0.4
    config.silero_vad.max_speech_duration = 20  # Whisper 는 한 번에 30초까지
    config.sample_rate = RATE
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)

    window = config.silero_vad.window_size
    lines = []

    def drain():
        while not vad.empty():
            seg = vad.front
            stream = recognizer.create_stream()
            stream.accept_waveform(RATE, seg.samples)
            recognizer.decode_stream(stream)
            text = stream.result.text.strip()
            if text:
                lines.append(f"[{mmss(seg.start // RATE)}] {text}")
            vad.pop()

    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i:i + window])
        drain()
    vad.flush()
    drain()

    pathlib.Path(out_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"lines={len(lines)} seconds={len(samples) // RATE}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("사용법: transcribe_sherpa.py 입력소리 출력.txt")
    main(sys.argv[1], sys.argv[2])
