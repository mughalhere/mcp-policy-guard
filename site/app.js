/**
 * Demo wiring. The guard itself is the real library — this file only builds
 * configurations, forwards calls, and renders what comes back.
 */
import {
  allow,
  and,
  argEquals,
  argStartsWith,
  createGuardedHandler,
  deny,
  GuardMetrics,
  not,
  requireConfirmation,
} from "./mcp-policy-guard.js";

const $ = (id) => document.getElementById(id);

/** Stand-in tools. Each returns something worth redacting. */
const tools = {
  list_contacts: async () => ({
    contacts: [
      { id: "c1", name: "Ada Lovelace", email: "ada@example.com", phone: "+1 415-555-0100" },
      { id: "c2", name: "Alan Turing", email: "alan@example.com", phone: "+1 415-555-0142" },
    ],
  }),
  get_contact: async (args) => ({
    id: args.id ?? "c1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    card: "4111 1111 1111 1111",
    apiKey: "sk-live-0123456789abcdefghij",
  }),
  delete_contact: async (args) => ({ deleted: args.id ?? null }),
  admin_purge: async () => ({ purged: true }),
  read_file: async (args) => ({ path: args.path, contents: "owner: ada@example.com\n" }),
  write_file: async (args) => ({ written: args.path }),
  run_sql: async (args) => ({ query: args.query, rows: 2 }),
  deploy: async (args) => ({ env: args.env, status: "queued" }),
  generate_report: async () => ({ report: "quarterly", rows: 10_432 }),
};

const scenarios = {
  crm: {
    label: "CRM server",
    blurb:
      "Reads flow, writes are gated behind a confirmation token, admin tooling is refused outright.",
    tools: ["list_contacts", "get_contact", "delete_contact", "admin_purge"],
    defaultCall: { tool: "get_contact", args: { id: "c1" } },
    source: `guard(server, {
  policies: [
    allow("{list,get}_*"),
    requireConfirmation("delete_*"),
    deny("admin_*", { reason: "admin tooling is not exposed over MCP" }),
  ],
  rateLimit: { windowMs: 60_000, maxCalls: 8 },
  redact: { patterns: "strict" },
  audit: { sink: (entry) => log.info(entry) },
});`,
    options: () => ({
      policies: [
        allow("{list,get}_*"),
        requireConfirmation("delete_*"),
        deny("admin_*", { reason: "admin tooling is not exposed over MCP" }),
      ],
      rateLimit: { windowMs: 60_000, maxCalls: 8 },
      redact: { patterns: "strict" },
    }),
  },

  filesystem: {
    label: "Filesystem, confined",
    blurb:
      "The same tool is permitted or refused depending on the path it is pointed at — the rule reads the arguments, not just the name.",
    tools: ["read_file", "write_file"],
    defaultCall: { tool: "read_file", args: { path: "/workspace/notes.md" } },
    source: `guard(server, {
  policies: [
    allow("read_file", { when: argStartsWith("path", "/workspace/") }),
    requireConfirmation("write_file", {
      when: argStartsWith("path", "/workspace/"),
    }),
  ],
  redact: { patterns: ["email"] },
});

// Try /etc/shadow — same tool, refused on its arguments.`,
    options: () => ({
      policies: [
        allow("read_file", { when: argStartsWith("path", "/workspace/") }),
        requireConfirmation("write_file", { when: argStartsWith("path", "/workspace/") }),
      ],
      redact: { patterns: ["email"] },
    }),
  },

  sql: {
    label: "SQL gateway",
    blurb:
      "A conditional deny narrows one tool to SELECT statements. Note the deny is evaluated before the broad allow, whatever order you wrote them in.",
    tools: ["run_sql", "generate_report"],
    defaultCall: { tool: "run_sql", args: { query: "SELECT id FROM contacts" } },
    source: `guard(server, {
  policies: [
    deny("run_sql", {
      when: not(argStartsWith("query", "SELECT")),
      reason: "only SELECT statements are permitted",
    }),
    allow("run_sql"),
    allow("generate_report"),
  ],
  rateLimit: {
    windowMs: 60_000,
    maxCalls: 20,
    overrides: [{ patterns: ["generate_report"], maxCalls: 2 }],
  },
});

// Try DROP TABLE contacts — or call generate_report three times.`,
    options: () => ({
      policies: [
        deny("run_sql", {
          when: not(argStartsWith("query", "SELECT")),
          reason: "only SELECT statements are permitted",
        }),
        allow("run_sql"),
        allow("generate_report"),
      ],
      rateLimit: {
        windowMs: 60_000,
        maxCalls: 20,
        overrides: [{ patterns: ["generate_report"], maxCalls: 2 }],
      },
    }),
  },

  deploy: {
    label: "Escalating on risk",
    blurb:
      "Dev deploys run unattended; production deploys need confirmation. One tool, two treatments, decided by precedence.",
    tools: ["deploy"],
    defaultCall: { tool: "deploy", args: { env: "dev" } },
    source: `guard(server, {
  policies: [
    deny("deploy", {
      when: and(argEquals("env", "prod"), argEquals("force", true)),
      reason: "forced production deploys are never permitted",
    }),
    requireConfirmation("deploy", { when: argEquals("env", "prod") }),
    allow("deploy"),
  ],
  timeoutMs: 15_000,
});

// Try { "env": "prod" } — then add "force": true.`,
    options: () => ({
      policies: [
        deny("deploy", {
          when: and(argEquals("env", "prod"), argEquals("force", true)),
          reason: "forced production deploys are never permitted",
        }),
        requireConfirmation("deploy", { when: argEquals("env", "prod") }),
        allow("deploy"),
      ],
      timeoutMs: 15_000,
    }),
  },
};

let current = "crm";
let handler;
let metrics;
let auditEntries = [];
let pendingToken = null;

function buildHandler() {
  const scenario = scenarios[current];
  metrics = new GuardMetrics();
  auditEntries = [];
  pendingToken = null;

  const inner = async (request) => {
    const impl = tools[request.params.name];
    const payload = impl
      ? await impl(request.params.arguments ?? {})
      : { error: `no such tool: ${request.params.name}` };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  };

  handler = createGuardedHandler(inner, {
    ...scenario.options(),
    audit: { sink: (entry) => auditEntries.unshift(entry) },
    onDecision: (event) => metrics.record(event),
  });
}

function classify(result, parsed) {
  if (!result.isError) return { kind: "allow", label: "allowed" };
  const code = parsed?.error;
  if (code === "confirmation_required") return { kind: "gate", label: "confirmation required" };
  if (code === "rate_limited") return { kind: "block", label: "rate limited" };
  if (code === "invalid_arguments") return { kind: "block", label: "invalid arguments" };
  if (code === "confirmation_failed") return { kind: "block", label: "confirmation failed" };
  if (code === "denied") return { kind: "block", label: "denied" };
  return { kind: "block", label: code ?? "error" };
}

function parseBody(result) {
  const text = result.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function invoke(name, args) {
  const result = await handler({ params: { name, arguments: args } });
  const parsed = parseBody(result);
  const verdict = classify(result, parsed);

  pendingToken = parsed?.confirmationToken ?? null;
  $("retry").disabled = !pendingToken;

  return { result, parsed, verdict };
}

function renderResult({ result, parsed, verdict }) {
  const badge = $("verdict");
  badge.className = `verdict ${verdict.kind}`;
  badge.textContent = verdict.label;

  const text = result.content?.[0]?.text ?? "";
  $("result").textContent = parsed ? JSON.stringify(parsed, null, 2) : text;

  const hint = $("hint");
  if (verdict.kind === "gate") {
    hint.textContent =
      "The call did not run. Press “Retry with token” to resend it with the confirmationToken — the token is single-use and bound to these exact arguments.";
  } else if (parsed?.error === "rate_limited") {
    hint.textContent = `Bucket exhausted at the ${parsed.scope} scope. Retry in ${parsed.retryAfterMs} ms, or press Reset.`;
  } else if (parsed?.error === "confirmation_failed") {
    hint.textContent = "Tokens are single-use and bound to the arguments they were issued for.";
  } else {
    hint.textContent = "";
  }
}

function renderAudit() {
  const list = $("audit");
  $("audit-count").textContent = `${auditEntries.length} ${auditEntries.length === 1 ? "entry" : "entries"}`;

  if (auditEntries.length === 0) {
    list.innerHTML =
      '<li class="empty">Every decision is recorded — including the ones that never reach a tool.</li>';
    return;
  }

  const dot = (outcome) => {
    if (outcome === "success") return "allow";
    if (outcome === "confirmation_required") return "gate";
    return "block";
  };

  list.innerHTML = auditEntries
    .slice(0, 40)
    .map((entry) => {
      const time = entry.ts.slice(11, 19);
      return `<li>
        <span class="dot ${dot(entry.outcome)}"></span>
        <span class="tool">${escapeHtml(entry.tool)} · ${escapeHtml(entry.decision)}</span>
        <span class="ms">${time}</span>
      </li>`;
    })
    .join("");
}

function renderStats() {
  const snapshot = metrics.snapshot();
  const cells = [
    ["calls", snapshot.calls],
    ["allowed", snapshot.allowed],
    ["denied", snapshot.denied],
    ["gated", snapshot.confirmationsRequired],
    ["limited", snapshot.rateLimited],
  ];
  $("stats").innerHTML = cells
    .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

function readArgs() {
  const raw = $("args").value.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    throw new Error("arguments must be a JSON object");
  } catch (err) {
    return { __invalid: err instanceof Error ? err.message : String(err) };
  }
}

async function onCall() {
  const args = readArgs();
  if (args.__invalid) {
    $("verdict").className = "verdict block";
    $("verdict").textContent = "bad JSON";
    $("result").textContent = `// arguments must be valid JSON\n// ${args.__invalid}`;
    return;
  }

  renderResult(await invoke($("tool").value, args));
  renderAudit();
  renderStats();
}

async function onRetry() {
  if (!pendingToken) return;
  const args = readArgs();
  if (args.__invalid) return;

  renderResult(await invoke($("tool").value, { ...args, confirmationToken: pendingToken }));
  renderAudit();
  renderStats();
}

async function onSpam() {
  const args = readArgs();
  if (args.__invalid) return;

  let last;
  for (let i = 0; i < 12; i++) last = await invoke($("tool").value, args);
  renderResult(last);
  renderAudit();
  renderStats();
  if (last.parsed?.error !== "rate_limited") {
    $("hint").textContent =
      "This scenario's budget absorbed all twelve. Try the CRM scenario, or generate_report under the SQL gateway.";
  }
}

function selectScenario(key) {
  current = key;
  const scenario = scenarios[key];

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.key === key));
  });

  $("policy-source").textContent = scenario.source;
  $("tool").innerHTML = scenario.tools
    .map((name) => `<option value="${name}">${name}</option>`)
    .join("");
  $("tool").value = scenario.defaultCall.tool;
  $("args").value = JSON.stringify(scenario.defaultCall.args, null, 2);

  buildHandler();

  $("verdict").className = "verdict idle";
  $("verdict").textContent = "awaiting call";
  $("result").textContent = `// ${scenario.blurb}\n// press "Call tool"`;
  $("hint").textContent = "";
  $("retry").disabled = true;
  renderAudit();
  renderStats();
}

function init() {
  $("scenarios").innerHTML = Object.entries(scenarios)
    .map(
      ([key, scenario]) =>
        `<button class="chip" data-key="${key}" aria-pressed="false">${scenario.label}</button>`,
    )
    .join("");

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => selectScenario(chip.dataset.key));
  });

  $("call").addEventListener("click", onCall);
  $("retry").addEventListener("click", onRetry);
  $("spam").addEventListener("click", onSpam);
  $("reset").addEventListener("click", () => selectScenario(current));

  selectScenario("crm");
}

init();
