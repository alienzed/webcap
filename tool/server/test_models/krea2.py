import copy
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")


def default_prompt(workflow):
    inputs = ((workflow.get("332") or {}).get("inputs") or {})
    prompt = str(inputs.get("wildcard_text") or inputs.get("populated_text") or "").strip()
    if not prompt:
        raise ValueError("Krea Test workflow has no default prompt in node 332.")
    return prompt


def template_settings(workflow):
    dimensions = str((((workflow.get("328") or {}).get("inputs") or {}).get("dimensions") or "")).strip()
    if not dimensions:
        raise ValueError("Krea Test workflow has no dimensions in node 328.")
    return {"dimensions": dimensions}


def normalize_settings(workflow, new_seed, values=None):
    defaults = template_settings(workflow)
    selected = values if isinstance(values, dict) else {}
    selected_dimensions = str(selected.get("dimensions") or defaults["dimensions"]).strip()
    if not selected_dimensions:
        raise ValueError("Test dimensions are required.")
    try:
        seed = selected.get("seed")
        selected_seed = new_seed() if seed is None or str(seed).strip() == "" else int(seed)
    except (TypeError, ValueError) as exc:
        raise ValueError("Test seed must be numeric.") from exc
    if selected_seed < 0 or selected_seed >= 2 ** 63:
        raise ValueError("Test seed must be between 0 and 9223372036854775807.")
    return {
        "dimensions": selected_dimensions,
        "seed": selected_seed,
    }


def available_lora_names(available_names):
    return available_names("LoraLoader", "lora_name", "LoRA")


def resolve_assets(template, available_names, resolve_name):
    workflow = copy.deepcopy(template)
    specs = (
        ("316", "UNETLoader", "unet_name", "diffusion model"),
        ("317", "CLIPLoader", "clip_name", "CLIP model"),
        ("210", "VAELoader", "vae_name", "VAE"),
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

        power_inputs = workflow["315"]["inputs"]
        fixed_loras = [
            value
            for value in power_inputs.values()
            if isinstance(value, dict) and value.get("on") is True and str(value.get("lora") or "").strip()
        ]
        if fixed_loras:
            lora_names = available_lora_names(available_names)
            for entry in fixed_loras:
                entry["lora"] = resolve_name(entry["lora"], lora_names, "fixed workflow LoRA")
    except (KeyError, TypeError) as exc:
        raise ValueError("Krea Test workflow is missing required model inputs.") from exc
    return workflow


def workflow_seed(workflow):
    inputs = ((workflow.get("276") or {}).get("inputs") or {}) if isinstance(workflow, dict) else {}
    try:
        return int(inputs.get("seed"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Krea Test workflow has no usable seed in node 276.") from exc


def build_workflow(
    template,
    prompt,
    comfy_lora_name,
    settings=None,
    strength_model=1,
    strength_clip=1,
    filename_prefix=None,
):
    workflow = copy.deepcopy(template)
    selected = dict(settings) if settings is not None else template_settings(template)
    if "seed" not in selected:
        selected["seed"] = workflow_seed(template)
    try:
        prompt_inputs = workflow["332"]["inputs"]
        prompt_inputs["wildcard_text"] = prompt
        prompt_inputs["populated_text"] = prompt
        prompt_inputs["mode"] = "fixed"

        workflow["276"]["inputs"]["seed"] = selected["seed"]
        workflow["328"]["inputs"]["dimensions"] = selected["dimensions"]

        if comfy_lora_name:
            candidate_inputs = workflow["334"]["inputs"]
            candidate_inputs["lora_name"] = comfy_lora_name
            candidate_inputs["strength_model"] = strength_model
            candidate_inputs["strength_clip"] = strength_clip
        else:
            power_inputs = workflow["315"]["inputs"]
            power_inputs["model"] = ["316", 0]
            power_inputs["clip"] = ["317", 0]
            workflow.pop("334", None)

        if filename_prefix:
            workflow["213"]["inputs"]["filename_prefix"] = str(filename_prefix)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Krea Test workflow is missing required Test bindings.") from exc
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
