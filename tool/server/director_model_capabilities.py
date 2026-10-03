import json


ADVERTISED_CAPABILITIES = [
    {
        "match": ["gemma-4-31b-mystery-fine-tune-heretic-uncensored-instruct"],
        "contextTokens": 131072,
        "contextLabel": "128k max",
        "contextKind": "publisher",
        "sourceUrl": "https://huggingface.co/DavidAU/gemma-4-31B-it-Mystery-Fine-Tune-HERETIC-UNCENSORED-Thinking-Instruct-GGUF",
        "notes": ["Publisher card states max context 128k."],
    },
    {
        "match": ["gemma-4-e4b-it-ultra-uncensored-heretic"],
        "contextTokens": 131072,
        "contextLabel": "128k",
        "contextKind": "inherited",
        "sourceUrl": "https://huggingface.co/llmfan46/gemma-4-E4B-it-ultra-uncensored-heretic",
        "notes": ["Gemma 4 E4B derivative; context inherited from the base architecture."],
    },
    {
        "match": ["gemma-4-e4b-it-heretic"],
        "contextTokens": 131072,
        "contextLabel": "128k",
        "contextKind": "inherited",
        "sourceUrl": "https://ollama.com/igorls/gemma-4-E4B-it-heretic-GGUF",
        "notes": ["Ollama package advertises the Gemma 4 128k context window."],
    },
    {
        "match": ["glm-4.7-30b-a3b-20-2-heretic"],
        "contextLabel": "202k max",
        "contextKind": "publisher-approximate",
        "recommendedContextMin": 8192,
        "recommendedContextMax": 16384,
        "sourceUrl": "https://huggingface.co/DavidAU/GLM-4.7-Flash-Grande-Heretic-UNCENSORED-42B-A3B-GGUF",
        "notes": [
            "Publisher recommends 8k-16k context despite a stated 202k maximum.",
            "Known issue: looping or odd characters; regenerate or try Q5_1.",
            "Publisher recommends a fresh chat and clearing llama.cpp cache between tests.",
        ],
    },
    {
        "match": ["hemmingway-1-extreme", "hemmingway-1-heretic"],
        "contextTokens": 262144,
        "contextLabel": "262,144",
        "contextKind": "publisher",
        "sourceUrl": "https://huggingface.co/richardyoung/Hemmingway-1-heretic-GGUF",
        "notes": [
            "Model supports 262,144 context.",
            "Some Ollama packages ship with a much smaller runtime num_ctx; runtime configuration still matters.",
        ],
    },
    {
        "match": ["magidonia-24b-v4.3"],
        "contextTokens": 131072,
        "contextLabel": "131,072",
        "contextKind": "model-config",
        "sourceUrl": "https://huggingface.co/TheDrummer/Magidonia-24B-v4.3",
        "notes": ["Model config declares max_position_embeddings=131072."],
    },
    {
        "match": ["qwen3.5-4b-nsfw-ara-heretic-literotica"],
        "contextTokens": 262144,
        "contextLabel": "262,144",
        "contextKind": "inherited",
        "recommendedOutputTokens": 32768,
        "extendedRecommendedOutputTokens": 81920,
        "sourceUrl": "https://huggingface.co/Qwen/Qwen3.5-4B",
        "notes": [
            "Context and output guidance are inherited from the Qwen3.5 base family.",
            "32,768 output is the normal recommendation; 81,920 is suggested for unusually complex reasoning workloads.",
        ],
    },
    {
        "match": ["qwen3.6-35b-a3b-uncensored-heretic"],
        "contextTokens": 262144,
        "contextLabel": "262,144",
        "contextKind": "publisher",
        "recommendedOutputTokens": 32768,
        "extendedRecommendedOutputTokens": 81920,
        "sourceUrl": "https://huggingface.co/devmgllc/Qwen3.6-35B-A3B-uncensored-heretic",
        "notes": [
            "Publisher recommends 32,768 output tokens for most queries.",
            "81,920 is suggested for highly complex benchmark-style workloads.",
        ],
    },
    {
        "match": ["qwen3.8-27b-tturbo-fable", "qwen3.8-27b-fablecoldfusion"],
        "contextTokens": 262144,
        "contextLabel": "262,144 native",
        "contextKind": "publisher",
        "extendedContextTokens": 1000000,
        "recommendedOutputTokens": 131072,
        "sourceUrl": "https://huggingface.co/DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored-NM-DAU-NEO-MTP-GGUF",
        "notes": [
            "Native context is 262,144; YaRN can extend supported runtimes toward 1M.",
            "Publisher guidance suggests up to 131,072 tokens for the final response.",
        ],
    },
    {
        "match": ["qwen3.8-9b-distill-uncensored-heretic"],
        "contextTokens": 262144,
        "contextLabel": "262,144",
        "contextKind": "publisher",
        "recommendedOutputTokens": 16384,
        "sourceUrl": "https://huggingface.co/petruhonk/Qwen3.8-9B-Distill-uncensored-heretic",
        "notes": [
            "Publisher recommends 16,384 max_new_tokens.",
            "Greedy decoding on long generations is documented as a repetition-loop failure mode for this model family.",
        ],
    },
    {
        "match": ["qwen3.5-9b-uncensored"],
        "contextTokens": 262144,
        "contextLabel": "256k advertised",
        "contextKind": "runtime-package",
        "runtimeContextTokens": 65536,
        "sourceUrl": "https://ollama.com/srchmnmichael/qwen3.5-9B-uncensored",
        "notes": [
            "Ollama advertises a 256k model window.",
            "The package documentation also shows PARAMETER num_ctx 65536 for its Hermes setup; WebCap should prefer live runtime metadata when available.",
        ],
    },
    {
        "match": ["qwen3.5-heretic"],
        "contextTokens": 262144,
        "contextLabel": "256k advertised",
        "contextKind": "runtime-package",
        "sourceUrl": "https://ollama.com/sorc/qwen3.5-heretic",
        "notes": ["Ollama package advertises a 256k context window."],
    },
]


def capability_for_model(model_ref="", model_id="", label=""):
    haystack = " ".join(
        str(value or "").strip().lower()
        for value in (model_ref, model_id, label)
        if str(value or "").strip()
    )
    if not haystack:
        return None
    for capability in ADVERTISED_CAPABILITIES:
        matches = capability.get("match") if isinstance(capability.get("match"), list) else []
        if any(str(token or "").lower() in haystack for token in matches):
            value = {key: item for key, item in capability.items() if key != "match"}
            return json.loads(json.dumps(value))
    return None



def list_capability_hints():
    return json.loads(json.dumps(ADVERTISED_CAPABILITIES))
