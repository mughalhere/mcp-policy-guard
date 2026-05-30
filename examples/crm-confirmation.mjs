/**
 * Fake CRM server showing confirmation flow on delete_contact.
 * Run: node examples/crm-confirmation.mjs  (after npm run build)
 */
import {
  createGuardedHandler,
  allow,
  requireConfirmation,
} from "../dist/index.js";

const contacts = new Map([["c1", { id: "c1", name: "Ada Lovelace" }]]);

const inner = async (req) => {
  if (req.params.name === "list_contacts") {
    return { content: [{ type: "text", text: JSON.stringify([...contacts.values()]) }] };
  }
  if (req.params.name === "delete_contact") {
    const id = req.params.arguments?.id;
    contacts.delete(String(id));
    return { content: [{ type: "text", text: JSON.stringify({ deleted: id }) }] };
  }
  return { content: [{ type: "text", text: "unknown" }], isError: true };
};

const handler = createGuardedHandler(inner, {
  policies: [allow("list_*"), requireConfirmation("delete_*")],
  audit: { sink: "stdout" },
});

console.log("list", await handler({ params: { name: "list_contacts", arguments: {} } }));
const first = await handler({ params: { name: "delete_contact", arguments: { id: "c1" } } });
console.log("needs confirm", first.content[0].text);
const { confirmationToken } = JSON.parse(first.content[0].text);
const second = await handler({
  params: { name: "delete_contact", arguments: { id: "c1", confirmationToken } },
});
console.log("deleted", second);
console.log("remaining", await handler({ params: { name: "list_contacts", arguments: {} } }));
