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

Then install WebCap:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

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

## 17. What WebCap may automate later

WebCap currently diagnoses the environment but does not automatically rewrite the GPU training stack.

Future setup assistance may safely automate low-risk, deterministic steps such as:

- checking prerequisites;
- creating directories/configuration;
- installing WebCap's own Python requirements;
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

WebCap has additional optional runtimes for inference, testing, local Director models, and analysis features.

Those dependencies are intentionally not folded into the MH3 training baseline. They should be installed and validated according to the feature that needs them.

This document will expand as those optional environments are reviewed.

## Upstream references

- Diffusion Pipe: https://github.com/tdrussell/diffusion-pipe
- Diffusion Pipe supported models: https://github.com/tdrussell/diffusion-pipe/blob/main/docs/supported_models.md
- MiniMax H3 example: https://github.com/tdrussell/diffusion-pipe/blob/main/examples/minimax_h3_example.toml
