import copy

from .common import normalize_name, validate_seed


OUTPUT_EXTENSIONS = (".mp4",)
ASPECT_RATIO_OPTIONS = (
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
)


def default_prompt(workflow):
    inputs = ((workflow.get("146") or {}).get("inputs") or {})
    prompt = str(inputs.get("wildcard_text") or inputs.get("populated_text") or "").strip()
    if not prompt:
        raise ValueError("MiniMax H3 workflow has no default prompt.")
    return prompt


def template_settings(workflow):
    resolution = ((workflow.get("115") or {}).get("inputs") or {})
    duration = ((workflow.get("133") or {}).get("inputs") or {})
    return {
        "aspectRatio": str(resolution.get("aspect_ratio") or "").strip(),
        "megapixels": float(resolution.get("megapixels") or 0),
        "duration": float(duration.get("value") or 0),
    }


def normalize_settings(workflow, new_seed, values=None):
    defaults = template_settings(workflow)
    selected = values if isinstance(values, dict) else {}
    aspect = str(selected.get("aspectRatio") or defaults["aspectRatio"]).strip()
    if aspect not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported MiniMax H3 aspect ratio: " + aspect)
    try:
        megapixels = float(defaults["megapixels"] if selected.get("megapixels") in (None, "") else selected.get("megapixels"))
        duration = float(defaults["duration"] if selected.get("duration") in (None, "") else selected.get("duration"))
        seed = selected.get("seed")
        seed = validate_seed(new_seed() if seed is None or str(seed).strip() in ("", "-1") else seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("H3 resolution, duration, and seed must be numeric.") from exc
    if megapixels <= 0:
        raise ValueError("H3 resolution must be greater than zero megapixels.")
    if duration < 4 or duration > 15:
        raise ValueError("MiniMax H3 duration must be between 4 and 15 seconds.")
    return {
        "aspectRatio": aspect,
        "megapixels": megapixels,
        "duration": duration,
        "seed": seed,
    }


def setting_options(_workflow, _available_names):
    return {"aspectRatio": list(ASPECT_RATIO_OPTIONS)}


def available_lora_names(available_names):
    return available_names("LoraLoader", "lora_name", "LoRA")


def resolve_assets(template, available_names, resolve_name):
    workflow = copy.deepcopy(template)
    specs = (
        ("127", "UNETLoader", "unet_name", "diffusion model"),
        ("128", "CLIPLoader", "clip_name", "CLIP model"),
        ("119", "VAELoader", "vae_name", "video VAE"),
        ("120", "VAELoader", "vae_name", "audio VAE"),
    )
    cache = {}
    try:
        for node_id, node_type, input_name, label in specs:
            inputs = workflow[node_id]["inputs"]
            key = (node_type, input_name)
            if key not in cache:
                cache[key] = available_names(node_type, input_name, label)
            inputs[input_name] = resolve_name(inputs[input_name], cache[key], label)
        available_loras = available_lora_names(available_names)
        turbo_inputs = workflow["148"]["inputs"]
        turbo_inputs["lora_name"] = resolve_name(turbo_inputs["lora_name"], available_loras, "LoRA")
        for value in workflow["138"]["inputs"].values():
            if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip():
                value["lora"] = resolve_name(value["lora"], available_loras, "LoRA")
    except (KeyError, TypeError) as exc:
        raise ValueError("MiniMax H3 workflow is missing required model inputs.") from exc
    return workflow


def base_loras(workflow):
    inputs = ((workflow.get("148") or {}).get("inputs") or {})
    name = str(inputs.get("lora_name") or "").strip()
    if not name:
        raise ValueError("MiniMax H3 inference workflow is missing the required Turbo LoRA.")
    return [name]


def build_workflow(template, prompt, settings, loras, uploaded_references, filename_prefix, available_names, resolve_name):
    workflow = resolve_assets(template, available_names, resolve_name)
    selected = dict(settings or {})
    prompt_inputs = workflow["146"]["inputs"]
    prompt_inputs["wildcard_text"] = prompt
    prompt_inputs["populated_text"] = prompt
    prompt_inputs["seed"] = selected["seed"]
    workflow["115"]["inputs"]["aspect_ratio"] = selected["aspectRatio"]
    workflow["115"]["inputs"]["megapixels"] = selected["megapixels"]
    workflow["133"]["inputs"]["value"] = selected["duration"]
    workflow["129"]["inputs"]["noise_seed"] = selected["seed"]
    workflow["141"]["inputs"]["filename_prefix"] = filename_prefix

    power = workflow["138"]["inputs"]
    available_loras = available_lora_names(available_names)
    existing = {normalize_name(name) for name in base_loras(workflow)}
    existing.update({
        normalize_name(value.get("lora"))
        for value in power.values()
        if isinstance(value, dict) and value.get("on") is True and value.get("lora")
    })
    next_index = 1
    for item in loras or []:
        resolved = resolve_name(item.get("name"), available_loras, "LoRA")
        if normalize_name(resolved) in existing:
            raise RuntimeError("Selected LoRA is already part of the required H3 workflow: " + resolved)
        while "lora_" + str(next_index) in power:
            next_index += 1
        power["lora_" + str(next_index)] = {
            "on": True,
            "lora": resolved,
            "strength": float(item.get("strength", 1.0)),
        }
        existing.add(normalize_name(resolved))
        next_index += 1

    for role, node_id in {"first_frame": "190", "last_frame": "191"}.items():
        image_name = str((uploaded_references or {}).get(role) or "").strip()
        if not image_name:
            continue
        workflow[node_id] = {
            "inputs": {"image": image_name},
            "class_type": "LoadImage",
            "_meta": {"title": "Generate " + role.replace("_", " ")},
        }
        workflow["131"]["inputs"][role] = [node_id, 0]
    return workflow


def effective_input(workflow):
    prompt_inputs = ((workflow.get("146") or {}).get("inputs") or {})
    resolution = ((workflow.get("115") or {}).get("inputs") or {})
    duration = ((workflow.get("133") or {}).get("inputs") or {})
    noise = ((workflow.get("129") or {}).get("inputs") or {})
    power = ((workflow.get("138") or {}).get("inputs") or {})

    references = {}
    for role, node_id in {"first_frame": "190", "last_frame": "191"}.items():
        inputs = ((workflow.get(node_id) or {}).get("inputs") or {})
        image = str(inputs.get("image") or "").strip()
        if image:
            references[role] = image

    loras = []
    for value in power.values():
        if not isinstance(value, dict) or value.get("on") is not True:
            continue
        name = str(value.get("lora") or "").strip()
        if not name:
            continue
        strength = value.get("strength", 1.0)
        loras.append({
            "name": name,
            "strength": 1.0 if strength in (None, "") else float(strength),
        })

    return {
        "prompt": str(prompt_inputs.get("populated_text") or prompt_inputs.get("wildcard_text") or ""),
        "promptMode": str(prompt_inputs.get("mode") or ""),
        "seed": noise.get("noise_seed"),
        "aspectRatio": str(resolution.get("aspect_ratio") or ""),
        "megapixels": resolution.get("megapixels"),
        "durationSeconds": duration.get("value"),
        "references": references,
        "loras": loras,
    }


def find_output_ref(value):
    if isinstance(value, dict):
        filename = str(value.get("filename") or "")
        if filename.lower().endswith(OUTPUT_EXTENSIONS):
            return {
                "filename": filename,
                "subfolder": str(value.get("subfolder") or ""),
                "type": str(value.get("type") or "output"),
                "fullpath": str(value.get("fullpath") or ""),
            }
        for child in value.values():
            found = find_output_ref(child)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_output_ref(child)
            if found:
                return found
    return None
