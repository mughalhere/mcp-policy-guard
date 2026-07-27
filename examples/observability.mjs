/**
 * Audit fan-out, metrics, and redaction.
 * Run: node examples/observability.mjs   (after npm run build)
 */
import { allow, createGuardedHandler, deny, GuardMetrics, DEFAULT_SENSITIVE_KEYS } from "../dist/index.js";

const metrics = new GuardMetrics();
const auditTrail = [];

const inner = async (req) => {
  if (req.params.name === "get_customer") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Ada Lovelace",
            email: "ada@example.com",
            phone: "+1 415-555-0100",
            card: "4111 1111 1111 1111",
            apiKey: "sk-live-0123456789abcdefghij",
          }),
        },
      ],
    };
  }
  throw new Error("boom");
};

const handler = createGuardedHandler(inner, {
  policies: [allow("get_*"), deny("drop_*")],

  // Redact PII on the way out; also redact whatever the audit trail records.
  // Add `preserveLast: 4` to keep a card's last four digits visible.
  redact: {
    patterns: "strict",
    keys: [...DEFAULT_SENSITIVE_KEYS],
  },

  // One audit entry, two destinations: an in-memory ring and a JSONL file.
  audit: {
    sink: [(entry) => auditTrail.push(entry), "file"],
    filePath: "./tmp/audit.jsonl",
    includeArgs: true,
  },

  onDecision: (event) => metrics.record(event),
});

console.log("redacted:", (await handler({ params: { name: "get_customer", arguments: { id: "c1" } } })).content[0].text);
console.log("denied:", (await handler({ params: { name: "drop_table", arguments: { table: "users" } } })).content[0].text);

try {
  await handler({ params: { name: "get_other", arguments: {} } });
} catch {
  // The guard records the failure, then rethrows so the host sees the real error.
}

console.log("audit entries:", auditTrail.length);
console.log("first entry:", JSON.stringify(auditTrail[0], null, 2));
console.log("metrics:", JSON.stringify(metrics.snapshot(), null, 2));
