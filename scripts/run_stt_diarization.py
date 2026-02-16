#!/usr/bin/env python3
"""Run local STT + diarization using whisperx.

Expected dependencies in Python env:
- whisperx
- torch
- pyannote (pulled by whisperx diarization pipeline)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def report_progress(percent: int, message: str) -> None:
    sys.stderr.write(f"STT_PROGRESS {percent} {message}\n")
    sys.stderr.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local STT + diarization worker")
    parser.add_argument("--input", required=True, help="Path to normalized audio file")
    parser.add_argument("--output", required=True, help="Path to output transcript JSON")
    parser.add_argument("--recording-id", required=True, help="Recording id")
    parser.add_argument("--model", default="medium", help="WhisperX model name")
    parser.add_argument("--language", default="ru", help="Language code")
    parser.add_argument("--device", default="cpu", help="torch device")
    parser.add_argument("--compute-type", default="int8", help="WhisperX compute type")
    parser.add_argument("--batch-size", type=int, default=8, help="Batch size")
    parser.add_argument("--hf-token", default="", help="HuggingFace token for diarization")
    parser.add_argument("--require-diarization", action="store_true", help="Fail if diarization cannot run")
    return parser.parse_args()


def normalize_segments(segments: list[dict], require_diarization: bool) -> list[dict]:
    output: list[dict] = []
    fallback_index = 1
    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue

        start = float(seg.get("start", 0.0) or 0.0)
        end = float(seg.get("end", start) or start)
        speaker = seg.get("speaker")

        if not speaker:
            if require_diarization:
                raise RuntimeError("Segment without speaker label while diarization is required")
            speaker = f"SPEAKER_{fallback_index}"
            fallback_index += 1

        output.append(
            {
                "startSec": max(0.0, start),
                "endSec": max(start, end),
                "speakerId": str(speaker),
                "text": text,
            }
        )

    return output


def main() -> int:
    args = parse_args()

    try:
        import whisperx
    except Exception as exc:  # pragma: no cover - runtime dependency error
        sys.stderr.write(f"Failed to import whisperx: {exc}\n")
        return 2

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        audio = whisperx.load_audio(str(input_path))
        report_progress(24, "audio_loaded")

        model = whisperx.load_model(
            args.model,
            args.device,
            compute_type=args.compute_type,
            language=args.language,
        )
        report_progress(30, "model_loaded")

        transcript = model.transcribe(audio, batch_size=args.batch_size)
        report_progress(52, "transcribe_done")
        lang = transcript.get("language") or args.language

        align_model, metadata = whisperx.load_align_model(language_code=lang, device=args.device)
        report_progress(60, "align_model_loaded")
        aligned = whisperx.align(
            transcript["segments"],
            align_model,
            metadata,
            audio,
            args.device,
            return_char_alignments=False,
        )
        report_progress(72, "align_done")

        diarization_used = False
        result = aligned

        hf_token = args.hf_token or os.getenv("HUGGINGFACE_TOKEN", "")
        if hf_token:
            diarization = whisperx.DiarizationPipeline(use_auth_token=hf_token, device=args.device)
            diarized = diarization(audio)
            result = whisperx.assign_word_speakers(diarized, aligned)
            diarization_used = True
            report_progress(88, "diarization_done")
        elif args.require_diarization:
            raise RuntimeError("Diarization required but --hf-token is not provided")
        else:
            report_progress(84, "without_diarization")

        segments = normalize_segments(result.get("segments", []), args.require_diarization)
        if not segments:
            raise RuntimeError("No transcript segments were produced")

        payload = {
            "recordingId": args.recording_id,
            "language": lang,
            "model": args.model,
            "diarization": diarization_used,
            "segments": segments,
        }

        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        report_progress(100, "done")
        return 0
    except Exception as exc:  # pragma: no cover - runtime execution path
        sys.stderr.write(f"STT worker failed: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
