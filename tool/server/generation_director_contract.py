from pathlib import Path

from .h3_prompt_contract import mode_from_reference_roles


DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"
H3_RUNTIME_CONTEXT_PATH = DOCS_ROOT / "mmh3-prompt-runtime-context.txt"
VALID_OPERATIONS = {"write_prompt", "refine_prompt"}


def _read_text(path, label):
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Could not read " + label + ".") from exc


def build_request(model_id, operation, prompt="", instruction="", settings=None, reference_roles=None):
    operation = str(operation or "").strip().lower()
    if operation not in VALID_OPERATIONS:
        raise ValueError("Unsupported Generate Director operation.")

    model_id = str(model_id or "").strip()
    prompt = str(prompt or "").strip()
    instruction = str(instruction or "").strip()
    settings = settings if isinstance(settings, dict) else {}
    reference_roles = reference_roles if isinstance(reference_roles, list) else []

    blocks = [
        "[DIRECTOR CONTEXT]\n"
        "You are helping write one standalone image or video generation prompt inside WebCap Generate. "
        "There is no Story or Scene continuity unless the user explicitly supplies it. Preserve explicit facts, "
        "avoid inventing unrelated narrative, and return only the complete model-facing prompt without commentary."
    ]

    if model_id == "minimax_h3":
        h3_mode = mode_from_reference_roles(reference_roles)
        blocks.append("[MODEL GUIDANCE]\n" + _read_text(H3_RUNTIME_CONTEXT_PATH, "MiniMax H3 runtime context"))
        duration = settings.get("duration")
        if duration not in (None, ""):
            blocks.append("[OUTPUT BUDGET]\nTarget duration: " + str(duration) + " seconds.")
        blocks.append("[REFERENCE MODE]\n" + h3_mode)
        if h3_mode != "T2VA":
            blocks.append(
                "[REFERENCE HANDLING]\n"
                "Attached exact reference roles: "
                + ", ".join(reference_roles)
                + ". Treat them as conditioning anchors. WebCap will prepend the required mechanical "
                "MiniMax H3 reference-alignment statement when the generation request is frozen. "
                "Do not reproduce or invent that alignment syntax in your answer."
            )
    elif model_id == "krea2_raw":
        blocks.append(
            "[MODEL GUIDANCE]\nWrite a concrete image-generation prompt using visible subject, wardrobe, "
            "environment, lighting, composition, camera/view, and texture details that materially help the requested image. "
            "Do not add video timing, shot progression, dialogue, or sound."
        )

    if operation == "write_prompt":
        if not prompt:
            raise ValueError("Generate prompt idea is required.")
        blocks.append("[USER IDEA]\n" + prompt)
        blocks.append(
            "[CURRENT TASK]\nTurn the user idea into a polished prompt for the selected generation model. "
            "Preserve the requested subject and intent; add useful production detail only where it supports that intent. "
            "Return only the complete prompt text."
        )
    else:
        if not prompt:
            raise ValueError("Existing Generate prompt is required.")
        if not instruction:
            raise ValueError("A refinement instruction is required.")
        blocks.append("[EXISTING PROMPT]\n" + prompt)
        blocks.append(
            "[CURRENT TASK]\nApply this correction with the smallest coherent change:\n"
            + instruction
            + "\n\nPreserve unrelated prompt details and return only the complete revised prompt text."
        )

    return {
        "operation": operation,
        "output": "text",
        "prompt": "\n\n".join(blocks).strip() + "\n",
    }
