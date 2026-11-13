//! Top Notch registry: an append-only public record of agent mandates and audit reports.
//! - An agent account publishes its own mandate hash (so the link agent <-> mandate is signed by the agent).
//! - Only the auditor account can publish audit reports.
//! - Nothing can be edited or deleted: history is the evidence.
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Mandate {
    pub agent: AccountId,
    pub mandate_hash: String,
    /// The full mandate text (JSON). The hash is computed on-chain from it.
    pub mandate: String,
    pub block_height: u64,
    pub timestamp_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub agent: AccountId,
    pub mandate_hash: String,
    pub report_hash: String,
    pub opinion: String,
    pub trades_tested: u32,
    pub findings: u32,
    pub uri: String,
    pub block_height: u64,
    pub timestamp_ns: u64,
}

const OPINIONS: [&str; 4] = ["clean", "qualified", "adverse", "disclaimer"];

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    auditor: AccountId,
    mandates: LookupMap<AccountId, Vec<Mandate>>,
    reports: LookupMap<AccountId, Vec<Report>>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn check_hash(h: &str) {
    require!(h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()), "hash must be 64 hex chars (sha256)");
}

#[near]
impl Registry {
    #[init]
    pub fn new(auditor: AccountId) -> Self {
        Self { auditor, mandates: LookupMap::new(b"m"), reports: LookupMap::new(b"r") }
    }

    /// Called BY the agent account: "this is the mandate I promise to follow".
    /// The full text is stored and its sha256 is computed here, so nobody can swap it later.
    pub fn publish_mandate(&mut self, mandate: String) -> Mandate {
        require!(!mandate.is_empty() && mandate.len() <= 2000, "mandate must be 1..2000 bytes");
        let agent = env::predecessor_account_id();
        let mandate_hash = hex(&env::sha256(mandate.as_bytes()));
        let m = Mandate { agent: agent.clone(), mandate_hash, mandate, block_height: env::block_height(), timestamp_ns: env::block_timestamp() };
        self.mandates.entry(agent.clone()).or_default().push(m.clone());
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"topnotch\",\"version\":\"1.0.0\",\"event\":\"mandate_published\",\"data\":{{\"agent\":\"{}\",\"mandate_hash\":\"{}\"}}}}", agent, m.mandate_hash));
        m
    }

    /// Called by the auditor only.
    pub fn publish_report(&mut self, agent: AccountId, mandate_hash: String, report_hash: String, opinion: String, trades_tested: u32, findings: u32, uri: String) -> Report {
        require!(env::predecessor_account_id() == self.auditor, "only the auditor can publish reports");
        check_hash(&mandate_hash);
        check_hash(&report_hash);
        require!(OPINIONS.contains(&opinion.as_str()), "opinion must be clean|qualified|adverse|disclaimer");
        require!(uri.len() <= 300, "uri too long");
        let known = self.mandates.get(&agent).map(|v| v.iter().any(|m| m.mandate_hash == mandate_hash)).unwrap_or(false);
        require!(known || opinion == "disclaimer", "mandate not published by this agent (only a disclaimer is allowed)");
        let r = Report { agent: agent.clone(), mandate_hash, report_hash, opinion, trades_tested, findings, uri, block_height: env::block_height(), timestamp_ns: env::block_timestamp() };
        self.reports.entry(agent.clone()).or_default().push(r.clone());
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"topnotch\",\"version\":\"1.0.0\",\"event\":\"report_published\",\"data\":{{\"agent\":\"{}\",\"opinion\":\"{}\",\"report_hash\":\"{}\"}}}}", agent, r.opinion, r.report_hash));
        r
    }

    pub fn get_auditor(&self) -> AccountId { self.auditor.clone() }
    pub fn get_mandates(&self, agent: AccountId) -> Vec<Mandate> { self.mandates.get(&agent).cloned().unwrap_or_default() }
    pub fn get_reports(&self, agent: AccountId) -> Vec<Report> { self.reports.get(&agent).cloned().unwrap_or_default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const H1: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const H2: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    fn ctx(pred: &str) { testing_env!(VMContextBuilder::new().predecessor_account_id(pred.parse().unwrap()).build()); }

    #[test]
    fn agent_publishes_and_auditor_reports() {
        ctx("auditor.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        ctx("bot.near");
        let m = c.publish_mandate("{\"max_trade_usd\":3}".into());
        assert_eq!(m.mandate_hash, hex(&env::sha256(b"{\"max_trade_usd\":3}")));
        ctx("auditor.near");
        c.publish_report("bot.near".parse().unwrap(), m.mandate_hash.clone(), H2.into(), "qualified".into(), 8, 1, "https://x".into());
        assert_eq!(c.get_reports("bot.near".parse().unwrap())[0].opinion, "qualified");
        assert_eq!(c.get_mandates("bot.near".parse().unwrap()).len(), 1);
    }

    #[test]
    #[should_panic(expected = "only the auditor")]
    fn stranger_cannot_report() {
        ctx("auditor.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        ctx("bot.near");
        c.publish_report("bot.near".parse().unwrap(), H1.into(), H2.into(), "clean".into(), 1, 0, "".into());
    }

    #[test]
    #[should_panic(expected = "mandate not published")]
    fn clean_opinion_needs_published_mandate() {
        ctx("auditor.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        c.publish_report("bot.near".parse().unwrap(), H1.into(), H2.into(), "clean".into(), 1, 0, "".into());
    }

    #[test]
    fn disclaimer_allowed_without_mandate() {
        ctx("auditor.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        c.publish_report("bot.near".parse().unwrap(), H1.into(), H2.into(), "disclaimer".into(), 0, 0, "".into());
    }

    #[test]
    #[should_panic(expected = "hash must be")]
    fn bad_hash_rejected() {
        ctx("auditor.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        c.publish_report("bot.near".parse().unwrap(), "nothex".into(), H2.into(), "disclaimer".into(), 0, 0, "".into());
    }

    #[test]
    #[should_panic(expected = "mandate must be")]
    fn empty_mandate_rejected() {
        ctx("bot.near");
        let mut c = Registry::new("auditor.near".parse().unwrap());
        c.publish_mandate("".into());
    }
}
