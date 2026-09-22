import copy
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
        raise ValueError("MiniMax H3 Test Bench workflow has no default prompt in node 146.")
    return prompt


def template_settings(workflow):
    resolution = ((workflow.get("115") or {}).get("inputs") or {})
    duration = ((workflow.get("133") or {}).get("inputs") or {})
    return {
        "aspectRatio": str(resolution.get("aspect_ratio") or "").strip(),
        "megapixels": float(resolution.get("megapixels") or 0),
        "duration": float(duration.get("value") or 0),
    }


def normalize_settings(workflow, new_seed, aspect_ratio=None, megapixels=None, duration=None, seed=None):
    defaults = template_settings(workflow)
    selected_aspect = str(aspect_ratio or defaults["aspectRatio"]).strip()
    if selected_aspect not in ASPECT_RATIO_OPTIONS:
        raise ValueError("Unsupported Test Generations aspect ratio: " + selected_aspect)
    try:
        selected_megapixels = float(defaults["megapixels"] if megapixels is None else megapixels)
        selected_duration = float(defaults["duration"] if duration is None else duration)
        selected_seed = new_seed() if seed is None or str(seed).strip() == "" else int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("Test resolution, duration, and seed must be numeric.") from exc
    if selected_megapixels <= 0:
        raise ValueError("Test resolution must be greater than zero megapixels.")
    if selected_duration <= 0:
        raise ValueError("Test duration must be greater than zero seconds.")
    if selected_seed < 0 or selected_seed >= 2 ** 63:
        raise ValueError("Test seed must be between 0 and 9223372036854775807.")
    return {
        "aspectRatio": selected_aspect,
        "megapixels": selected_megapixels,
        "duration": selected_duration,
        "seed": selected_seed,
    }


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
    available_cache = {}
    try:
        for node_id, node_type, input_name, label in specs:
            inputs = workflow[node_id]["inputs"]
            configured = inputs[input_name]
            cache_key = (node_type, input_name)
            if cache_key not in available_cache:
                available_cache[cache_key] = available_names(node_type, input_name, label)
            inputs[input_name] = resolve_name(configured, available_cache[cache_key], label)

        power_inputs = workflow["138"]["inputs"]
        enabled_power_loras = [
            value
            for value in power_inputs.values()
            if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip()
        ]
        if enabled_power_loras:
            lora_names = available_lora_names(available_names)
            for entry in enabled_power_loras:
                entry["lora"] = resolve_name(entry["lora"], lora_names, "LoRA")
    except (KeyError, TypeError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing required model inputs.") from exc
    return workflow


def workflow_seed(workflow):
    inputs = ((workflow.get("129") or {}).get("inputs") or {}) if isinstance(workflow, dict) else {}
    try:
        return int(inputs.get("noise_seed"))
    except (TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow has no usable seed.") from exc


def build_workflow(template, prompt, comfy_lora_name, settings=None, strength_model=0.9, strength_clip=1, filename_prefix=None):
    workflow = copy.deepcopy(template)
    selected = dict(settings) if settings is not None else template_settings(template)
    if "seed" not in selected:
        selected["seed"] = workflow_seed(template)
    try:
        prompt_inputs = workflow["146"]["inputs"]
        prompt_inputs["wildcard_text"] = prompt
        prompt_inputs["populated_text"] = prompt
        prompt_inputs["mode"] = "fixed"
        if comfy_lora_name:
            lora_inputs = workflow["148"]["inputs"]
            lora_inputs["lora_name"] = comfy_lora_name
            lora_inputs["strength_model"] = strength_model
            lora_inputs["strength_clip"] = strength_clip
        else:
            power_inputs = workflow["138"]["inputs"]
            power_inputs["model"] = ["161", 0]
            power_inputs["clip"] = ["128", 0]
            workflow.pop("148", None)
        workflow["115"]["inputs"]["aspect_ratio"] = selected["aspectRatio"]
        workflow["115"]["inputs"]["megapixels"] = selected["megapixels"]
        workflow["133"]["inputs"]["value"] = selected["duration"]
        workflow["129"]["inputs"]["noise_seed"] = selected["seed"]
        if filename_prefix:
            workflow["141"]["inputs"]["filename_prefix"] = str(filename_prefix)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("MiniMax H3 Test Bench workflow is missing required test inputs.") from exc
    return workflow


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
