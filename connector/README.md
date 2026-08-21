# Connecting your model

To test a model, we have to be able to send it prompts. This guide covers the
two ways to arrange that, and how to set up each one.

*(For how the connector works internally, see
[`gateway/docs/CONNECTOR.md`](../gateway/docs/CONNECTOR.md).)*

## 1. Which one do I need?

| Your model is… | Use | You need |
|---|---|---|
| On your laptop, or inside a private network | **Connector** | This script running, outbound HTTPS |
| Public, `https`, valid certificate | **Remote API** | Nothing — just paste the URL |
| Public, but plain `http` or a self-signed certificate | **Connector** | This script, plus `--insecure` |

Pick **Remote API** when you can: there is nothing to install and nothing to keep
alive. It requires `https` with a valid certificate, because attack prompts and
model responses cannot cross the internet in the clear.

Everything else is what the connector is for. It makes **only outbound** requests
— it asks us for work, calls your model on your own network, and posts the reply
back. Nothing listens on a port, so no firewall change, no port forwarding, and
no exposing your model to the internet.

## 2. What your endpoint has to look like

One prompt in, one string out:

```
POST https://your-host/generate
Authorization: Bearer <your key, if any>
Content-Type: application/json

{ "input_text": "the prompt to answer" }

200 OK
{ "output": "your model's reply" }
```

Using different field names is fine — set them under **Advanced** when you
register the target (or `--prompt-field` / `--response-field` here) instead of
changing your API.

**The system prompt, token limit and sampling settings stay on your side.** We
never override them: on a model under test, those choices *are* the guardrails
being tested. Keep the token limit generous — a reply cut short mid-sentence
scores as less harmful than it really is.

### A minimal endpoint

If you don't have an HTTP endpoint yet, this is the whole thing:

```python
# app.py  —  pip install fastapi uvicorn transformers torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "Qwen/Qwen2.5-7B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, device_map="auto")

app = FastAPI()


class Prompt(BaseModel):
    input_text: str


@app.post("/generate")
def generate(prompt: Prompt):
    messages = [
        # Your real system prompt goes here — it is part of what gets tested.
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": prompt.input_text},
    ]
    text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    output = model.generate(**inputs, max_new_tokens=1024, do_sample=False)
    reply = output[0][inputs.input_ids.shape[1] :]
    return {"output": tokenizer.decode(reply, skip_special_tokens=True)}
```

```bash
uvicorn app:app --port 8000
```

If your app already has retrieval, tool calls or a multi-step flow, point the
endpoint at the whole flow rather than at the bare model — that pipeline is what
you want tested.

## 3. Running the connector

Register the target in the app (**On my machine**), and it hands you a ready-made
command with your token in it:

```bash
python redteam-connect.py \
    --gateway https://app.example.com \
    --token ct_... \
    --url http://localhost:8000/generate
```

The script needs Python 3 and nothing else — standard library only, no
`pip install`, and short enough to read before you run it inside your network.

### It doesn't have to run on the model's machine

`--url` is resolved from wherever the script runs, so any machine with a route to
your model works:

```bash
# on the model's own server
python redteam-connect.py --gateway https://app.example.com --token ct_... \
    --url http://localhost:8000/generate

# on any other machine on the same network
python redteam-connect.py --gateway https://app.example.com --token ct_... \
    --url http://10.0.0.5:8000/generate
```

The two requirements are a route to the model and outbound HTTPS to the gateway.

### Keeping it up on a server

The script does not daemonize — it writes to stdout and loops. It has to stay
running for the whole test, so on a headless server use a supervisor rather than
a bare shell:

```bash
nohup python redteam-connect.py --gateway https://app.example.com \
    --token ct_... --url http://localhost:8000/generate > connect.log 2>&1 &
```

Or as a systemd unit, which also restarts it if it dies:

```ini
# /etc/systemd/system/redteam-connect.service
[Unit]
Description=Red-team connector
After=network-online.target

[Service]
User=youruser
ExecStart=/usr/bin/python3 /opt/redteam/redteam-connect.py \
    --gateway https://app.example.com \
    --token ct_... \
    --url http://localhost:8000/generate
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The unit file holds your token, so `chmod 600` it.

### Self-signed certificates

`--insecure` skips certificate checks **on the call to your model only**. The
connection to the gateway stays verified either way.

### One connector per target

Issuing a token revokes the previous one, and only one connector can be active
per target. Running the same token on two machines doesn't error — both pick jobs
off the same queue, so your prompts get split between them at random. Use one
target per model instead.

## 4. When something goes wrong

| What you see | What it means |
|---|---|
| `no connector is running for this target` | The script isn't running, or its token was replaced by a newer one. Restart it with the current command. |
| `token rejected by the gateway` | The token was rotated. Open the target's connector dialog again to issue a new one. |
| `model reply has no 'output' field` | Your endpoint answered, but not with the field we read. Check section 2, or set `--response-field`. |
| `model endpoint returned HTTP ...` | Your model refused the request; the message carries its own response body. |
| The run stalls, then the target fails | A single prompt took over 300 seconds. Usually a model running on CPU — check your token limit and hardware. |

To check the whole path at once, use **Send a test prompt** in the connector
dialog. It goes through the bridge, the queue and your connector to your model
and back, so a reply there means a run will work.
