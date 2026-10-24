// src/lib/status.js — the status vocabulary from migration 006. Values are enforced by CHECK
// constraints in the database; the labels and tones here are the only place the UI names them.

export const LIFECYCLE = ["prospect", "engaged", "customer", "former"];
export const LIFECYCLE_LABEL = { prospect: "Prospect", engaged: "Engaged", customer: "Customer", former: "Former client" };
export const LIFECYCLE_TONE = { prospect: "ocean", engaged: "iris", customer: "evergreen", former: "pebble" };

export const LEAD_STATUS = ["new", "attempted", "connected", "unqualified"];
export const LEAD_STATUS_LABEL = { new: "New", attempted: "Attempted", connected: "Connected", unqualified: "Unqualified" };
export const LEAD_STATUS_TONE = { new: "sand", attempted: "ember", connected: "evergreen", unqualified: "rust" };

export const CONSENT_SOURCES = ["badge_scan", "inbound_form", "imported_list", "verbal", "existing_client", "email_reply", "other"];
export const CONSENT_LABEL = { badge_scan: "Badge scan", inbound_form: "Inbound form", imported_list: "Imported list", verbal: "Verbal", existing_client: "Existing client", email_reply: "Email reply", other: "Other" };

export const DEAL_ROLES = ["decision_maker", "champion", "influencer", "planner", "procurement", "billing", "other"];
export const DEAL_ROLE_LABEL = { decision_maker: "Decision maker", champion: "Champion", influencer: "Influencer", planner: "Planner", procurement: "Procurement", billing: "Billing", other: "Contact" };

export const DEAL_TYPES = ["new", "repeat"];
export const DEAL_TYPE_LABEL = { new: "New business", repeat: "Repeat client" };

export const CAMPAIGN_KINDS = ["trade_show", "email", "referral", "inbound", "research", "import", "other"];
export const CAMPAIGN_KIND_LABEL = { trade_show: "Trade show", email: "Email", referral: "Referral", inbound: "Inbound", research: "Research", import: "Import", other: "Other" };
export const CAMPAIGN_KIND_TONE = { trade_show: "iris", email: "ocean", referral: "evergreen", inbound: "tropic", research: "pebble", import: "sand", other: "sand" };
export const CAMPAIGN_STATUS = ["planned", "active", "done", "archived"];
export const MEMBER_STATUS = ["added", "contacted", "responded", "met", "converted", "unsubscribed", "bounced"];

export const CALL_OUTCOMES = ["connected", "voicemail", "no_answer", "left_message"];
export const OUTCOME_LABEL = { connected: "Connected", voicemail: "Voicemail", no_answer: "No answer", left_message: "Left message", bounced: "Bounced" };

// "3d ago" / "Oct 12" for last-touch columns; null when never touched.
export function ago(ts) {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  const d = Math.floor(diff / 864e5);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
