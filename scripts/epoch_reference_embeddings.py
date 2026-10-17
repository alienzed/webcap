#!/usr/bin/env python3
"""Offline reference-to-render embedding comparison. Never mutates source media.

Optional dependencies: torch, transformers, pillow, safetensors.
Requires full Hugging Face model folders (config.json and image processor config),
not standalone .safetensors weights.
"""
import argparse
import json
from pathlib import Path


def _load_model(kind, directory, device):
    from transformers import AutoImageProcessor, AutoModel
    if kind == "dinov2":
        processor = AutoImageProcessor.from_pretrained(str(directory), local_files_only=True)
        model = AutoModel.from_pretrained(str(directory), local_files_only=True).to(device).eval()
    else:
        from transformers import AutoProcessor, AutoModel
        processor = AutoProcessor.from_pretrained(str(directory), local_files_only=True)
        model = AutoModel.from_pretrained(str(directory), local_files_only=True).to(device).eval()
    return processor, model


def _encode(kind, processor, model, paths, device):
    import torch
    import torch.nn.functional as F
    from PIL import Image, ImageOps
    vectors = []
    with torch.inference_mode():
        for path in paths:
            with Image.open(path) as image:
                rgb = ImageOps.exif_transpose(image).convert("RGB")
                if kind == "dinov2":
                    inputs = processor(images=rgb, return_tensors="pt")
                    out = model(**{k: v.to(device) for k, v in inputs.items()})
                    vector = out.last_hidden_state[:, 0, :]
                else:
                    inputs = processor(images=rgb, return_tensors="pt")
                    pixels = inputs["pixel_values"].to(device)
                    # SigLIP2 full model provides projected vision embeddings.
                    vector = model.get_image_features(pixel_values=pixels)
                    if not isinstance(vector, torch.Tensor):
                        vector = vector.pooler_output
                vectors.append(F.normalize(vector.float(), dim=-1).cpu()[0])
    return torch.stack(vectors)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("dinov2", "siglip2"), required=True)
    parser.add_argument("--model", type=Path, required=True, help="Local full Hugging Face model snapshot")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--renders", type=Path, nargs="+", required=True)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    args = parser.parse_args()
    import torch
    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else ("cpu" if args.device == "auto" else args.device)
    for p in [args.reference, *args.renders]:
        if not p.is_file():
            parser.error("Missing image: " + str(p))
    if not (args.model / "config.json").is_file():
        parser.error("Model folder needs config.json and processor files; weights alone are insufficient: " + str(args.model))
    processor, model = _load_model(args.kind, args.model, device)
    vectors = _encode(args.kind, processor, model, [args.reference, *args.renders], device)
    scores = torch.matmul(vectors[1:], vectors[0]).tolist()
    result = {"model": args.kind, "device": device, "reference": str(args.reference),
              "scores": [{"render": str(path), "cosineSimilarity": round(score, 6)}
                         for path, score in sorted(zip(args.renders, scores), key=lambda pair: pair[1], reverse=True)]}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
