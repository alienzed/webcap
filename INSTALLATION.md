# Installation

This guide covers a clean WebCap installation and the reference environment for managed MiniMax H3 training.

WebCap itself is intentionally lightweight. Training is not: modern AI training stacks combine Python, PyTorch, CUDA, NVIDIA drivers, DeepSpeed, model-specific dependencies, and large model files. WebCap therefore separates **core application readiness** from **training readiness** and provides an Environment Check to help identify what is missing.

## 1. What you are installing

There are three useful layers:

1. **WebCap core** — media browsing, curation, captioning, dataset preparation, review, and configuration.
2. **Optional inference features** — Storyboard, Generate, Test Generations, local Director models, and related external runtimes.
3. **Managed training** — Diffusion Pipe, DeepSpeed, CUDA-enabled PyTorch, NVIDIA GPU support, and model files.

You do not need a complete training environment to run WebCap core.

## 2. Core WebCap requirements

### Required

- Python **3.10 or newer**
- `pip`
- Git
- `ffmpeg` and `ffprobe` available on `PATH`

Python dependencies are installed from `requirements.txt`.

Python 3.10 is supported; WebCap uses the `tomli` compatibility package there because the standard-library `tomllib` module was introduced in Python 3.11.

### Ubuntu / WSL system packages

On a normal Ubuntu or WSL Ubuntu installation, the common system-level prerequisites can be installed with:

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg curl
```

Validate them before installing WebCap:

```bash
git --version
python3 --version
python3 -m pip --version
ffmpeg -version
ffprobe -version
curl --version
```

The commands only establish the ordinary host tools. GPU training dependencies are handled separately below.

### Recommended

Use a dedicated Python virtual environment rather than installing WebCap packages globally.

Example:

```bash
git clone https://github.com/alienzed/webcap.git
cd webcap

python -m venv .venv
```

Activate it.

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux / WSL:

```bash
source .venv/bin/activate
```

Install WebCap's Python requirements into the environment you will use to run WebCap:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

The same install can later be attempted from **Settings → Advanced → Install / Repair Python Requirements**.

## 3. Configure WebCap

Copy the example configuration:

Linux / WSL:

```bash
cp tool/config.example.json tool/config.json
```

Windows:

```text
copy tool\config.example.json tool\config.json
```

At minimum, configure `filesystem.root` to the directory that will contain your working sets and WebCap output.

`tool/config.json` is intentionally ignored by Git.

You can edit configuration directly or use **App Settings** after WebCap starts.

## 4. Start WebCap

From the repository root:

```bash
python -m tool.server.app
```

This is the normal launch path. Optional feature dependencies are loaded when their features need them, so a missing optional package should not prevent unrelated WebCap functionality from starting. When WebCap detects a missing Python package, use **Settings → Advanced → Install / Repair Python Requirements** to run the current WebCap interpreter against this repository's `requirements.txt`; the command output and failures are written to the WebCap Console.

The optional `start.py` wrapper remains available as a convenience bootstrap, but normal WebCap operation does not depend on launching through it.

Then open:

```text
http://127.0.0.1:4200/
```

WebCap is local-first and accepts application requests only from the local machine.

## 5. Run Environment Check

Open:

**App Settings → Training → Environment Check**

The Environment Check is intentionally independent from any dataset or training run.

It reports two separate states:

- **WebCap readiness** — host Python, pip, common Python packages, FFmpeg/FFprobe, and related tools.
- **Training readiness** — WSL/Linux shell, Diffusion Pipe, configured Python runtime, DeepSpeed, PyTorch/CUDA visibility, and NVIDIA telemetry.

A missing training environment does **not** mean the WebCap application itself is broken.

The checker reports detected versions/paths where useful and provides remediation guidance for failed checks.

---

# MiniMax H3 managed training

MiniMax H3 is the primary reference training environment for WebCap.

The goal of this section is to describe a **known-good baseline**, not to claim that only one exact Python/PyTorch/CUDA combination works.

## 6. MH3 reference environment

| Component | WebCap reference |
| --- | --- |
| Host OS | Windows with **WSL2**, or Linux |
| Training Python | **Python 3.12** |
| Training framework | Current **Diffusion Pipe** revision with MiniMax H3 support |
| Launcher | **DeepSpeed** |
| PyTorch | CUDA-enabled build compatible with the installed NVIDIA driver |
| CUDA | Match the PyTorch build; **CUDA 12.8** is an upstream documented known-good baseline |
| GPU | NVIDIA GPU |
| Practical VRAM baseline | **24 GB** |
| NVIDIA telemetry | `nvidia-smi` available inside the training environment |
| MH3 model weights | ComfyUI-format **int8 convrot** weights are recommended upstream |

Diffusion Pipe added MiniMax H3 support on **August 6, 2026** and CFG-augmented H3 training on **August 8, 2026**. Use a current checkout rather than an older Diffusion Pipe installation.

Upstream Diffusion Pipe currently creates its recommended environment with Python 3.12. Its installation documentation intentionally does **not** pin PyTorch because different NVIDIA GPUs can require different PyTorch/CUDA combinations.

The upstream documented example of **PyTorch 2.9.0 + CUDA 12.8** is therefore best treated as a known-good reference, not as a WebCap-enforced version.

Newer working combinations are acceptable. WebCap should prefer **detected functionality** over rejecting an environment merely because its versions are newer than the reference stack.

## 7. Why WSL2 on Windows

Diffusion Pipe is built around DeepSpeed. DeepSpeed has only partial native Windows support, so upstream Diffusion Pipe recommends **WSL2** for Windows users.

WebCap's managed training integration follows that model:

- WebCap may run on Windows.
- Diffusion Pipe runs inside WSL2.
- WebCap launches and monitors training through the configured WSL environment.

Native Windows Diffusion Pipe training is not the WebCap reference configuration.

## 8. Install Diffusion Pipe

Inside WSL2 or Linux:

```bash
git clone --recurse-submodules https://github.com/tdrussell/diffusion-pipe
cd diffusion-pipe
```

If the repository was cloned without submodules:

```bash
git submodule init
git submodule update
```

When updating later:

```bash
git pull
git submodule update
```

## 9. Create the training environment

Upstream Diffusion Pipe currently recommends Conda with Python 3.12:

```bash
conda create -n diffusion-pipe python=3.12
conda activate diffusion-pipe
```

A normal venv or an already-configured shell environment can also work. WebCap supports three runtime styles:

1. Conda executable + environment name.
2. A venv activation script.
3. The existing WSL shell environment.

Use one clear runtime method rather than mixing them.

## 10. Install PyTorch and CUDA support

Install PyTorch **before** the rest of Diffusion Pipe's requirements.

Upstream deliberately leaves PyTorch out of its requirements file because GPU generations sometimes need different PyTorch/CUDA combinations.

Start with a CUDA-enabled PyTorch release supported by your NVIDIA driver and GPU.

Then verify from inside the training environment:

```bash
python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA GPU')"
```

A healthy result should show:

- a PyTorch version;
- a CUDA build version;
- `True` for CUDA availability;
- your NVIDIA GPU name.

Do not blindly downgrade a working newer PyTorch/CUDA combination merely to match this document.

### NVCC

Diffusion Pipe also recommends installing NVIDIA `cuda-nvcc`, ideally matching the CUDA generation used by the selected PyTorch build.

## 11. Install Diffusion Pipe dependencies

With the training environment active:

```bash
python -m pip install -r requirements.txt
```

DeepSpeed is a hard Diffusion Pipe requirement.

Verify it:

```bash
deepspeed --version
```

Optional model dependencies such as Flash Attention should be installed only when the selected workflow needs them.

## 12. Verify NVIDIA access inside WSL

Run:

```bash
nvidia-smi
```

WebCap uses NVIDIA telemetry for environment reporting, GPU status, and H3 calibration.

If Windows can see the GPU but WSL cannot, fix the Windows/WSL NVIDIA driver integration before troubleshooting WebCap.

## 13. MiniMax H3 model files

Diffusion Pipe's current MiniMax H3 support uses ComfyUI-compatible model files.

Upstream currently recommends the quantized **int8 convrot** diffusion model and text encoder because they are faster, use less VRAM, and are preferred for direct quantized LoRA training.

The current upstream example references files equivalent to:

```text
minimax_h3_fl2va_pruned_int8_convrot.safetensors
minimax_h3_video_vae_fp16.safetensors
minimax_h3_audio_vae_fp32.safetensors
qwen3vl_32b_minimax_h3_int8_convrot.safetensors
```

Configure WebCap/model paths for your actual storage layout rather than copying example paths literally.

## 14. VRAM expectations

The current upstream MiniMax H3 example explicitly targets **24 GB VRAM** using:

- int8 convrot weights;
- LoRA rank 32;
- activation checkpointing;
- aggressive block swapping;
- micro batch size 1 for video.

For that reason, WebCap treats **24 GB as the practical reference floor for the standard MH3 LoRA workflow**, not as a claim that every dataset, resolution, frame count, rank, or configuration is guaranteed to fit.

Higher resolutions, longer clips, larger ranks, fewer swapped blocks, or other settings can require more VRAM.

## 15. Configure WebCap training

Open **App Settings → Training** and configure:

- **Diffusion Pipe WSL** — WSL/Linux path to the Diffusion Pipe repository containing `train.py`.
- **WSL Distribution** — optional explicit distribution name.
- **Conda Executable** + **Conda Environment**, or:
- **Venv Activate Script**, or:
- leave both unset when the WSL shell itself already contains the correct runtime.

Then run:

**Environment Check**

For managed MH3 training, you want the training section to confirm at least:

- WSL/Linux shell available;
- Diffusion Pipe directory available;
- training Python available;
- `train.py` available;
- DeepSpeed available;
- PyTorch sees CUDA and at least one GPU;
- `nvidia-smi` available.

The normal Training screen performs an additional **run-specific preflight** when a real training action is prepared. That deeper check also knows about the selected set, generated TOMLs, model profile, and captured artifacts.

---

# Troubleshooting installation

## 16. Do not hide the real error

AI environments change quickly. A dependency installation that worked several months ago may no longer be the best solution for a new GPU, driver, PyTorch release, or package revision.

When an install command fails:

1. Keep the complete error message.
2. Note your GPU model.
3. Note your OS / WSL distribution.
4. Record:
   - `python --version`
   - `python -c "import torch; print(torch.__version__, torch.version.cuda)"`
   - `nvidia-smi`
5. Search the **exact error text** together with the package name and GPU.
6. Check the current upstream project issues/documentation.
7. Ask an up-to-date interactive assistant such as ChatGPT, supplying the exact error and environment information above.

Do not repeatedly install random CUDA, PyTorch, or DeepSpeed versions into the same environment until something appears to work. A fresh environment is often safer and easier to reason about.

## 17. Current setup assistance and future boundaries

WebCap can currently diagnose the environment and explicitly install/repair its own Python requirements from **Settings → Advanced**. That action runs `python -m pip install -r requirements.txt` with the same Python executable that is running WebCap and reports the real command output in the Console.

WebCap does not automatically rewrite the GPU training stack.

Future setup assistance may safely automate other low-risk, deterministic steps such as:

- checking prerequisites;
- creating directories/configuration;
- cloning/updating known repositories;
- suggesting or running an explicitly shown command;
- re-running Environment Check after each step.

GPU-stack installation should remain **optional and transparent**. If an attempted helper command fails, WebCap should:

- stop that setup step;
- preserve and show the exact command;
- preserve stdout/stderr;
- explain which requirement remains unsatisfied;
- leave the environment available for manual repair;
- recommend current upstream documentation or interactive help rather than masking the failure.

An installation helper failing must not make an otherwise working WebCap installation unusable.

---

# Optional components

The following features are optional at the product level. Their supported Python packages remain in WebCap's single `requirements.txt`, while runtime imports are scoped so a missing optional package does not take down unrelated functionality.

## 18. Dependency map

| Capability | Current dependency | Where it runs | Current install ownership | Future setup posture |
| --- | --- | --- | --- | --- |
| Core media/video | FFmpeg / FFprobe | WebCap host | System package | Safe to detect and offer normal package-manager install |
| Background remove / blur | `rembg` + ONNX Runtime | WebCap Python | `requirements.txt` | Safe to install/repair with WebCap Python requirements |
| Face Focus / Deface | `deface` / CenterFace | WebCap Python | `requirements.txt` | Safe to install/repair with WebCap Python requirements |
| Selection pose / expression | MediaPipe | WebCap Python | `requirements.txt` | Safe to install/repair with WebCap Python requirements |
| Training history metrics | TensorBoard | WebCap Python | `requirements.txt` | Safe to install/repair with WebCap Python requirements |
| Storyboard Director, local | CUDA-enabled llama.cpp `llama-server` | Local machine / WSL topology | External runtime | Detect first; offer explicit build/install choices |
| Storyboard Director, remote | OpenAI-compatible HTTP endpoint | External service | User-managed | Validate endpoint only; nothing to install |
| Generate / Storyboard Takes / Test Generations | ComfyUI API | Local or reachable provider | External runtime | Detect/configure separately; do not install into WebCap's Python env |
| Managed MH3 training | Diffusion Pipe + DeepSpeed + CUDA PyTorch | WSL2/Linux | External training env | Guided/optional install; GPU stack requires explicit confirmation |
| Model files | GGUF / safetensors / VAEs / text encoders / LoRAs | User model storage | User-managed | Detect paths and explain missing files; avoid surprise multi-GB downloads |

## 19. Validate WebCap Python dependencies

After activating WebCap's own virtual environment:

```bash
python -c "import flask, PIL; print('WebCap core Python imports OK')"
python -c "import rembg, onnxruntime; print('rembg / ONNX Runtime OK')"
python -c "import mediapipe; print('MediaPipe', mediapipe.__version__)"
python -c "from deface.centerface import CenterFace; print('deface / CenterFace OK')"
python -c "import tensorboard; print('TensorBoard', tensorboard.__version__)"
```

Validate console tools:

```bash
command -v ffmpeg
command -v ffprobe
command -v deface
tensorboard --version
```

If these fail in a WebCap environment, use **Settings → Advanced → Install / Repair Python Requirements** or run:

```bash
python -m pip install -r requirements.txt
```

Do not create separate MediaPipe/rembg/deface environments unless a platform-specific conflict actually requires one.

### rembg model download

WebCap currently uses rembg's `u2net_human_seg` model. The Python package can be installed ahead of time, but rembg may obtain model data on first use depending on the local rembg cache state.

That makes the package itself a good auto-install candidate, while model acquisition should be surfaced as a potentially networked first-use/setup action rather than hidden behind an unrelated media button.

## 20. Local Storyboard Director: llama.cpp

WebCap's local Director looks for a `llama-server` executable or an explicit **App Settings → Storyboard → llama-server executable** path.

A normal CUDA-enabled Linux/WSL build is:

```bash
sudo apt update
sudo apt install -y git cmake build-essential

git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp

cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -t llama-server -j
```

The resulting binary is normally:

```text
./build/bin/llama-server
```

Validate it:

```bash
./build/bin/llama-server --version
```

If you want it discoverable without an explicit WebCap path, place or link it somewhere on `PATH`, then validate:

```bash
command -v llama-server
llama-server --version
```

WebCap itself owns starting/stopping its configured local Director process. You do **not** need to manually leave a llama.cpp server running when using local Director mode.

### CPU-only llama.cpp

A CPU-only build is possible:

```bash
cmake -B build
cmake --build build --config Release -t llama-server -j
```

This is useful for compatibility testing but may be impractically slow for the large Director models normally used with Storyboard.

### Remote Director

No local llama.cpp installation is required when **Director Mode = Remote**.

Validate an OpenAI-compatible endpoint outside WebCap with an endpoint-appropriate request. For a conventional server exposing `/v1/models`:

```bash
curl -fsS http://HOST:PORT/v1/models
```

Then configure the endpoint in **App Settings → Storyboard**.

Because remote providers differ, WebCap should validate the configured endpoint/capabilities rather than attempting to install or modify the remote service.

## 21. ComfyUI inference provider

WebCap uses a reachable ComfyUI HTTP API for Generate, Storyboard inference/Takes, and Test Generations.

WebCap currently expects the local provider at:

```text
http://127.0.0.1:8188
```

On the established Windows + WSL topology, WebCap can also use Windows `curl.exe` from WSL when communicating with that local Windows ComfyUI instance.

### Recommended ownership

ComfyUI should have its **own environment**. Do not install ComfyUI's PyTorch stack into WebCap's Python virtual environment.

For most Windows users, the official ComfyUI Desktop/portable distributions are the easiest route.

For a manual Linux installation, use a dedicated environment. The exact current PyTorch command is hardware-sensitive, so check current ComfyUI/PyTorch guidance before installing it. A conventional flow is:

```bash
git clone https://github.com/Comfy-Org/ComfyUI.git
cd ComfyUI

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

# Install the current GPU-appropriate PyTorch build first.
# Then:
python -m pip install -r requirements.txt
```

Run ComfyUI:

```bash
python main.py
```

Validate the exact API endpoint WebCap uses for provider discovery:

```bash
curl -fsS http://127.0.0.1:8188/system_stats
```

A JSON response confirms that the basic provider API is reachable.

WebCap also validates required model/node names when preparing inference. A reachable ComfyUI server can therefore still be **feature-incomplete** if the selected workflow's model files or nodes are absent.

### Current NVIDIA note

ComfyUI's upstream installation guidance changes with PyTorch/CUDA support and GPU generations. Do not freeze a WebCap-owned ComfyUI Torch command into an installer unless it is fetched/maintained deliberately.

This is a strong candidate for:

1. detecting the GPU;
2. detecting an existing working ComfyUI first;
3. offering the current upstream installation path;
4. running any proposed command only after the user sees it;
5. validating `/system_stats` afterward.

## 22. Optional Python analysis features

### MediaPipe selection analysis

Package installation is already covered by:

```bash
python -m pip install -r requirements.txt
```

Validation:

```bash
python -c "import mediapipe as mp; print(mp.__version__)"
```

WebCap also ships the MediaPipe task model files it expects under its vendored model directory, so this feature does not require a separate model download in the normal repository checkout.

### Deface / Face Focus

Validation:

```bash
python -c "from deface.centerface import CenterFace; CenterFace(backend='auto'); print('CenterFace OK')"
command -v deface
```

### rembg background operations

Validation:

```bash
python -c "import rembg, onnxruntime; print('rembg / ONNX Runtime OK')"
```

Actual segmentation-model readiness is best proven by a small real background-removal operation because the model cache may not exist until first use.

### TensorBoard

Validation:

```bash
tensorboard --version
python -c "import tensorboard; print(tensorboard.__version__)"
```

TensorBoard is used by WebCap's training-analysis/history tooling; it is not the training launcher itself.

---

# Auto-install roadmap

The installation document and Environment Check should describe the **same dependency graph**. That gives WebCap a deterministic path toward optional setup assistance without creating a second source of truth.

## 23. Installation states

Each dependency should eventually expose one of these states:

- **Ready** — detected and validated.
- **Missing** — nothing usable detected.
- **Misconfigured** — installed, but WebCap is pointed at the wrong path/environment.
- **Incompatible** — present but failed a functional validation.
- **Not configured** — optional feature has never been set up.
- **Unknown** — validation could not establish a safe conclusion.

Version differences alone should not produce **Incompatible** when the actual functional probe passes.

## 24. Automation classes

### Class A — safe to automate

These are deterministic and easy to validate afterward:

- copy `config.example.json` to `config.json`;
- create WebCap directories;
- create a WebCap virtual environment;
- install/repair `requirements.txt`;
- install ordinary Ubuntu packages such as Git, FFmpeg, curl, CMake, and build-essential after explicit user approval;
- clone/update Diffusion Pipe;
- clone/update llama.cpp;
- build llama.cpp from an explicitly selected CPU/CUDA configuration;
- re-run Environment Check.

Every command should still be shown and logged.

### Class B — automate only inside an explicitly selected environment

These are reasonable once ownership is unambiguous:

- create the Diffusion Pipe Conda environment with Python 3.12;
- install Diffusion Pipe's `requirements.txt`;
- install/update ComfyUI's own `requirements.txt`;
- install known optional Python packages into their owning environment.

WebCap must display the exact environment/path being modified before proceeding.

### Class C — guided, hardware-sensitive install

These should be optional and require confirmation of the proposed command:

- PyTorch CUDA/ROCm/XPU builds;
- CUDA/NVCC packages;
- GPU-specific llama.cpp builds;
- ComfyUI GPU runtime;
- Flash Attention or other compiled model-specific packages.

For these, WebCap should prefer current upstream guidance and **functional validation** over a hard-coded historical version matrix.

### Class D — detect/configure, do not silently install

- NVIDIA/AMD/Intel system drivers;
- WSL2 itself when administrator/reboot operations are required;
- remote Director services;
- large model/checkpoint downloads;
- licensed/gated model files;
- user-owned ComfyUI custom-node ecosystems.

WebCap can explain, link, validate, and perhaps launch an explicit external installer, but these should not happen as hidden prerequisites.

## 25. Proposed setup-assistant workflow

A future **Setup Assistant** can be straightforward:

1. Run Environment Check.
2. Group results by **Core**, **Training**, **Inference**, **Director**, and **Optional Analysis**.
3. For each missing item, show:
   - what it is used for;
   - whether it is required for the user's selected feature;
   - detected/current state;
   - proposed install/repair command;
   - target environment/path;
   - **Install / Copy Command / Skip**.
4. Run only the selected step.
5. Stream stdout/stderr visibly.
6. Re-run that dependency's validation.
7. Mark it Ready only when the functional probe succeeds.
8. Continue with the next selected dependency.

There is no need for a large package-management abstraction. The setup assistant can remain a finite list of explicit, app-owned installation recipes paired with explicit validation probes.

## 26. Failure contract for assisted installs

An attempted install is allowed to fail.

When it does, WebCap should:

- stop the current install step;
- leave unrelated setup steps available;
- show the exact command that ran;
- show the real exit code;
- preserve stdout/stderr in the WebCap Console;
- explain which validation still fails;
- provide a **Copy Error / Copy Diagnostics** action;
- suggest searching the exact error in current upstream issues/documentation;
- suggest giving the copied diagnostic block to an up-to-date interactive assistant such as ChatGPT.

A useful copied diagnostic block should contain, where relevant:

```text
WebCap version / commit:
Operating system:
WSL distribution:
GPU:
NVIDIA driver:
Python:
Python executable:
PyTorch:
PyTorch CUDA build:
CUDA available:
nvidia-smi:
Target environment:
Command attempted:
Exit code:
Error output:
```

The user should never have to transcribe a truncated toast or screenshot an error to get help.

## 27. Principle for version policy

WebCap should maintain:

- **minimums** only where there is a real known lower bound;
- **reference versions** for combinations we have actually used or upstream explicitly documents;
- **functional probes** wherever newer/different versions may still work.

This is especially important for PyTorch, CUDA, ComfyUI, llama.cpp, and DeepSpeed. The environment checker should say **different but working** rather than **wrong version** whenever the required capability is demonstrably present.

## Upstream references

- Diffusion Pipe: https://github.com/tdrussell/diffusion-pipe
- Diffusion Pipe supported models: https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md
- MiniMax H3 example: https://github.com/tdrussell/diffusion-pipe/blob/main/examples/minimax_h3_example.toml
- llama.cpp: https://github.com/ggml-org/llama.cpp
- llama.cpp server: https://github.com/ggml-org/llama.cpp/tree/master/tools/server
- ComfyUI: https://github.com/Comfy-Org/ComfyUI
