import copy

from .common import normalize_name, validate_seed


IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")


def default_prompt(workflow):
    inputs = ((workflow.get("332") or {}).get("inputs") or {})
    prompt = str(inputs.get("wildcard_text") or inputs.get("populated_text") or "").strip()
    if not prompt:
        raise ValueError("Krea2 workflow has no default prompt.")
    return prompt


def template_settings(workflow):
    dimensions = str((((workflow.get("328") or {}).get("inputs") or {}).get("dimensions") or ""))
    if not dimensions.strip():
        raise ValueError("Krea2 workflow has no dimensions.")
    return {"dimensions": dimensions}


def normalize_settings(workflow, new_seed, values=None):
    defaults = template_settings(workflow)
    selected = values if isinstance(values, dict) else {}
    dimensions = str(selected.get("dimensions") or defaults["dimensions"])
    if not dimensions.strip():
        raise ValueError("Krea2 dimensions are required.")
    seed = selected.get("seed")
    seed = validate_seed(new_seed() if seed is None or str(seed).strip() in ("", "-1") else seed)
    return {"dimensions": dimensions, "seed": seed}


def setting_options(workflow, available_names):
    choices = available_names("SDXL Empty Latent Image (rgthree)", "dimensions", "dimensions")
    selected = template_settings(workflow)["dimensions"]
    if selected not in choices:
        choices = [selected] + [item for item in choices if item != selected]
    return {"dimensions": choices}


def available_lora_names(available_names):
    return available_names("LoraLoader", "lora_name", "LoRA")


def resolve_assets(template, available_names, resolve_name):
    workflow = copy.deepcopy(template)
    specs = (
        ("316", "UNETLoader", "unet_name", "diffusion model"),
        ("317", "CLIPLoader", "clip_name", "CLIP model"),
        ("210", "VAELoader", "vae_name", "VAE"),
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
        for value in workflow["315"]["inputs"].values():
            if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip():
                value["lora"] = resolve_name(value["lora"], available_loras, "LoRA")
    except (KeyError, TypeError) as exc:
        raise ValueError("Krea2 workflow is missing required model inputs.") from exc
    return workflow


def base_loras(workflow):
    return [
        str(value.get("lora"))
        for value in ((workflow.get("315") or {}).get("inputs") or {}).values()
        if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip()
    ]


def build_workflow(template, prompt, settings, loras, _uploaded_references, filename_prefix, available_names, resolve_name):
    workflow = resolve_assets(template, available_names, resolve_name)
    selected = dict(settings or {})
    prompt_inputs = workflow["332"]["inputs"]
    prompt_inputs["wildcard_text"] = prompt
    prompt_inputs["populated_text"] = prompt
    prompt_inputs["seed"] = selected["seed"]
    workflow["276"]["inputs"]["seed"] = selected["seed"]
    workflow["328"]["inputs"]["dimensions"] = selected["dimensions"]
    workflow["213"]["inputs"]["filename_prefix"] = filename_prefix

    power = workflow["315"]["inputs"]
    power["model"] = ["316", 0]
    power["clip"] = ["317", 0]
    workflow.pop("334", None)

    available_loras = available_lora_names(available_names)
    existing = {
        normalize_name(value.get("lora"))
        for value in power.values()
        if isinstance(value, dict) and value.get("on") is True and value.get("lora")
    }
    next_index = 1
    for item in loras or []:
        resolved = resolve_name(item.get("name"), available_loras, "LoRA")
        if normalize_name(resolved) in existing:
            raise RuntimeError("Selected LoRA is already part of the base Krea2 workflow: " + resolved)
        while "lora_" + str(next_index) in power:
            next_index += 1
        power["lora_" + str(next_index)] = {
            "on": True,
            "lora": resolved,
            "strength": float(item.get("strength", 1.0)),
        }
        existing.add(normalize_name(resolved))
        next_index += 1
    return workflow


def find_output_ref(value):
    if isinstance(value, dict):
        filename = str(value.get("filename") or "")
        if filename.lower().endswith(IMAGE_EXTENSIONS):
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
