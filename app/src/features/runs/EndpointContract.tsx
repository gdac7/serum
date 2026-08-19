const EXAMPLE = `POST https://your-host/generate
Authorization: Bearer <your key, if any>
Content-Type: application/json

{ "input_text": "the prompt to answer" }

200 OK
{ "output": "your model's reply" }`;

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
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          background: "var(--color-surface-2, rgba(0,0,0,0.04))",
          padding: "var(--space-2)",
        }}
      >
        {EXAMPLE}
      </pre>
      <div>
        System prompt, token limit and sampling stay on your side — they're part of the
        behaviour being tested, so we never override them. Keep the token limit generous:
        replies cut short score as less harmful than they are.
      </div>
      <div>
        Different field names? Set them under <em>Advanced</em> below instead of changing
        your API.
      </div>
    </div>
  );
}
