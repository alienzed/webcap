"""One H3 sampling contract, checked against the workflow actually submitted to ComfyUI."""

TURBO_LORA_PREFIX = "minimax_h3_fl2v_turbo_4step_"


def normalize_mode(value):
    mode = str(value or "turbo").strip().lower()
    legacy = {"current": "turbo", "single": "turbo", "no_turbo": "quality"}
    mode = legacy.get(mode, mode)
    if mode not in ("turbo", "quality"):
        raise ValueError("Unsupported H3 sampling mode: " + mode)
    return mode


def submitted_sampling(workflow, mode):
    """Validate the final graph, including candidate LoRAs, before sending it."""
    mode = normalize_mode(mode)
    try:
        scheduler = workflow["124"]["inputs"]
        power = workflow["138"]["inputs"]
        steps = int(scheduler["steps"])
        if scheduler["model"] != ["138", 0]:
            raise ValueError("H3 scheduler is not connected to the final LoRA chain.")
        if workflow["126"]["inputs"]["model"] != ["138", 0]:
            raise ValueError("H3 guider is not connected to the final LoRA chain.")
        if workflow["131"]["inputs"]["clip"] != ["138", 1]:
            raise ValueError("H3 conditioning bypasses the effective LoRA CLIP chain.")
        sources = []
        single = workflow.get("148")
        if single is not None:
            inputs = single["inputs"]
            sources.append({
                "name": str(inputs["lora_name"]),
                "strength": float(inputs["strength_model"]),
                "source": "LoraLoader",
            })
        for key, entry in power.items():
            if key.startswith("lora_") and isinstance(entry, dict) and entry.get("on") is True:
                sources.append({
                    "name": str(entry["lora"]),
                    "strength": float(entry["strength"]),
                    "source": "Power Lora Loader",
                })
        turbo = [
            item for item in sources
            if item["name"].replace(chr(92), "/").split("/")[-1].casefold().startswith(TURBO_LORA_PREFIX)
        ]
        expected_steps = 8 if mode == "turbo" else 20
        if steps != expected_steps:
            raise ValueError("H3 " + mode + " requires " + str(expected_steps) + " steps; got " + str(steps) + ".")
        if mode == "turbo":
            if len(turbo) != 1 or turbo[0]["strength"] != 1.0:
                raise ValueError("H3 Turbo requires exactly one Turbo LoRA at strength 1.0.")
        elif turbo:
            raise ValueError("H3 Quality must not load a Turbo LoRA.")
        # Protect the effective loader wiring, not merely the template's list of names.
        expected_source = ["148", 0] if single is not None else ["161", 0]
        if power["model"] != expected_source:
            raise ValueError("H3 LoRA loader is not connected to the effective model.")
        if power["clip"] != (["148", 1] if single is not None else ["128", 0]):
            raise ValueError("H3 LoRA loader is not connected to the effective CLIP.")
        if single is not None and (
            single["inputs"]["model"] != ["161", 0]
            or single["inputs"]["clip"] != ["128", 0]
        ):
            raise ValueError("H3 standard LoRA node does not receive the expected model and CLIP.")
    except (KeyError, TypeError, OverflowError) as exc:
        raise ValueError("H3 submitted workflow has invalid sampling inputs.") from exc
    return {
        "mode": mode,
        "steps": steps,
        "turboEnabled": bool(turbo),
        "turboStrength": turbo[0]["strength"] if turbo else None,
        "loras": sources,
    }
