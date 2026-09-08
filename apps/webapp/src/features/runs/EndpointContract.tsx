const EXAMPLE = `POST https://your-host/generate
Authorization: Bearer <your key, if any>
Content-Type: application/json

{ "input_text": "the prompt to answer" }

200 OK
{ "output": "your model's reply" }`;

const SERVER = `# app.py  —  pip install fastapi uvicorn transformers torch
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

# uvicorn app:app --port 8000`;

const preStyle = {
  margin: 0,
  whiteSpace: "pre-wrap" as const,
  background: "var(--color-surface-2, rgba(0,0,0,0.04))",
  padding: "var(--space-2)",
  overflowX: "auto" as const,
};

/** The contract a target endpoint must implement, shown next to the URL field. */
export function EndpointContract() {
  return (
    <div
      className="form-hint"
      style={{
        border: "2px solid var(--color-divider)",
        padding: "var(--space-3)",
        marginBottom: "var(--space-2)",
        display: "grid",
        gap: "var(--space-2)",
      }}
    >
      <div>
        <strong>One prompt in, one string out.</strong> We POST JSON with a single{" "}
        <code>input_text</code> field and read the reply from <code>output</code>.
      </div>
      <pre style={preStyle}>{EXAMPLE}</pre>
      <div>
        System prompt, token limit and sampling stay on your side — they're part of the
        behaviour being tested, so we never override them. Keep the token limit generous:
        replies cut short score as less harmful than they are.
      </div>
      <div>
        Different field names? Set them under <em>Advanced</em> below instead of changing
        your API.
      </div>
      <details>
        <summary style={{ cursor: "pointer" }}>
          Don't have an endpoint yet? Here's a complete one
        </summary>
        <pre style={{ ...preStyle, marginTop: "var(--space-2)" }}>{SERVER}</pre>
        <div style={{ marginTop: "var(--space-2)" }}>
          If your app has retrieval, tool calls or a multi-step flow, point the endpoint at
          the whole flow rather than the bare model — that pipeline is what gets tested.
        </div>
      </details>
    </div>
  );
}
