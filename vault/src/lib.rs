//! Top Notch vault: an investor's own NEAR account that a managed agent can trade, but never empty.
//! - The OWNER (the investor) is the only one who can withdraw, pause, change the agent or the limits.
//! - The AGENT (run by the platform) can only send an allowed token, up to a per-trade cap and a
//!   daily trade count, to a one-time NEAR Intents (1Click) deposit address. Swap output and refunds
//!   come back to this vault, because the agent quotes with recipient = refundTo = this vault.
//! - Every swap is logged as an event, so the auditor can tie each deposit to its 1Click settlement.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct TokenLimit {
    pub token: AccountId,
    /// Max raw amount per swap (in the token's smallest unit).
    pub max_per_trade: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Policy {
    pub tokens: Vec<TokenLimit>,
    pub max_trades_per_day: u32,
    /// Free text: which strategy this vault follows (account/id), shown to auditors and the UI.
    pub strategy: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    agent: AccountId,
    policy: Policy,
    paused: bool,
    day: u64,
    trades_today: u32,
    swaps: u64,
    deposit_seen: LookupMap<AccountId, bool>,
}

const FT_GAS: Gas = Gas::from_tgas(15);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

fn is_implicit(a: &AccountId) -> bool {
    let s = a.as_str();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, policy: Policy) -> Self {
        require!(policy.max_trades_per_day > 0 && policy.tokens.len() <= 20, "bad policy");
        Self { owner, agent, policy, paused: false, day: 0, trades_today: 0, swaps: 0, deposit_seen: LookupMap::new(b"d") }
    }

    // ---------------- agent ----------------

    /// The only thing the agent can do: move an allowed token, within limits, to a fresh 1Click deposit address.
    pub fn swap(&mut self, token: AccountId, amount: U128, deposit_address: AccountId) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "only the agent can swap");
        require!(!self.paused, "vault is paused by its owner");
        require!(is_implicit(&deposit_address), "deposit address must be a one-time implicit account");
        require!(!self.deposit_seen.contains_key(&deposit_address), "deposit address already used");
        let limit = self.policy.tokens.iter().find(|t| t.token == token).unwrap_or_else(|| env::panic_str("token not allowed by the owner's policy"));
        require!(amount.0 > 0 && amount.0 <= limit.max_per_trade.0, "amount above the per-trade cap");
        let today = env::block_timestamp() / 86_400_000_000_000;
        if today != self.day { self.day = today; self.trades_today = 0; }
        require!(self.trades_today < self.policy.max_trades_per_day, "daily trade limit reached");
        self.trades_today += 1;
        self.swaps += 1;
        self.deposit_seen.insert(deposit_address.clone(), true);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"topnotch-vault\",\"version\":\"1.0.0\",\"event\":\"swap\",\"data\":{{\"n\":{},\"token\":\"{}\",\"amount\":\"{}\",\"deposit_address\":\"{}\"}}}}",
            self.swaps, token, amount.0, deposit_address
        ));
        Promise::new(token).function_call(
            "ft_transfer",
            format!("{{\"receiver_id\":\"{}\",\"amount\":\"{}\",\"memo\":\"topnotch swap {}\"}}", deposit_address, amount.0, self.swaps).into_bytes(),
            ONE_YOCTO,
            FT_GAS,
        )
    }

    /// 1Click pays NEAR out as native NEAR. The agent may wrap it to wNEAR so the position stays a token the
    /// policy can trade. It stays inside the vault; a reserve for storage and gas is always kept.
    pub fn wrap_near(&mut self, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "only the agent can wrap");
        require!(!self.paused, "vault is paused by its owner");
        let locked = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        let free = env::account_balance().saturating_sub(locked).saturating_sub(NearToken::from_millinear(50));
        require!(amount.0 > 0 && amount.0 <= free.as_yoctonear(), "amount above the vault's free NEAR (reserve kept)");
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"topnotch-vault\",\"version\":\"1.0.0\",\"event\":\"wrap\",\"data\":{{\"amount\":\"{}\"}}}}", amount.0));
        Promise::new("wrap.near".parse().unwrap()).function_call("near_deposit", b"{}".to_vec(), NearToken::from_yoctonear(amount.0), FT_GAS)
    }

    // ---------------- owner ----------------

    pub fn withdraw(&mut self, token: AccountId, amount: U128) -> Promise {
        self.assert_owner();
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"topnotch-vault\",\"version\":\"1.0.0\",\"event\":\"withdraw\",\"data\":{{\"token\":\"{}\",\"amount\":\"{}\"}}}}", token, amount.0));
        Promise::new(token).function_call(
            "ft_transfer",
            format!("{{\"receiver_id\":\"{}\",\"amount\":\"{}\"}}", self.owner, amount.0).into_bytes(),
            ONE_YOCTO,
            FT_GAS,
        )
    }

    pub fn withdraw_near(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn set_paused(&mut self, paused: bool) { self.assert_owner(); self.paused = paused; }
    pub fn set_agent(&mut self, agent: AccountId) { self.assert_owner(); self.agent = agent; }
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        require!(policy.max_trades_per_day > 0 && policy.tokens.len() <= 20, "bad policy");
        self.policy = policy;
    }

    // ---------------- views ----------------

    pub fn get_owner(&self) -> AccountId { self.owner.clone() }
    pub fn get_agent(&self) -> AccountId { self.agent.clone() }
    pub fn get_policy(&self) -> Policy { self.policy.clone() }
    pub fn is_paused(&self) -> bool { self.paused }
    pub fn get_swap_count(&self) -> u64 { self.swaps }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const DEP: &str = "4452b03bdc6caf652babcf3dd490ed18f3ae0ae1ee62cc6224ca9df9d270dd95";
    const DEP2: &str = "807f6e36f955cbbf88afa567107663ca4e32b7799949a8afda0543dcfc506196";

    fn ctx(pred: &str, day: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(pred.parse().unwrap()).block_timestamp(day * 86_400_000_000_000 + 1).build());
    }
    fn vault() -> Vault {
        ctx("owner.near", 1);
        Vault::new("owner.near".parse().unwrap(), "agent.near".parse().unwrap(), Policy {
            tokens: vec![TokenLimit { token: "usdc.near".parse().unwrap(), max_per_trade: U128(5_000_000) }],
            max_trades_per_day: 2,
            strategy: "researcher-1.top-notch.near/dip-in-uptrend".into(),
        })
    }

    #[test]
    fn agent_swaps_within_policy() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1_000_000), DEP.parse().unwrap());
        assert_eq!(v.get_swap_count(), 1);
    }

    #[test]
    #[should_panic(expected = "only the agent")]
    fn stranger_cannot_swap() {
        let mut v = vault();
        ctx("thief.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cannot_withdraw() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.withdraw("usdc.near".parse().unwrap(), U128(1));
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cannot_change_policy_or_itself() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.set_agent("agent2.near".parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "one-time implicit account")]
    fn agent_cannot_send_to_named_account() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), "agent.near".parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "token not allowed")]
    fn token_must_be_allowed() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("wrap.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "per-trade cap")]
    fn per_trade_cap() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(5_000_001), DEP.parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "already used")]
    fn deposit_address_single_use() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
    }

    #[test]
    fn daily_limit_resets_next_day() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP2.parse().unwrap());
        ctx("agent.near", 2);
        v.swap("usdc.near".parse().unwrap(), U128(1), "1111111111111111111111111111111111111111111111111111111111111111".parse().unwrap());
        assert_eq!(v.get_swap_count(), 3);
    }

    #[test]
    #[should_panic(expected = "daily trade limit")]
    fn daily_limit_enforced() {
        let mut v = vault();
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP2.parse().unwrap());
        v.swap("usdc.near".parse().unwrap(), U128(1), "1111111111111111111111111111111111111111111111111111111111111111".parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "only the agent can wrap")]
    fn stranger_cannot_wrap() {
        let mut v = vault();
        ctx("thief.near", 1);
        v.wrap_near(U128(1));
    }

    #[test]
    #[should_panic(expected = "reserve kept")]
    fn wrap_keeps_reserve() {
        let mut v = vault();
        ctx("agent.near", 1);
        let all = env::account_balance().as_yoctonear();
        v.wrap_near(U128(all));
    }

    #[test]
    #[should_panic(expected = "paused")]
    fn owner_can_pause() {
        let mut v = vault();
        ctx("owner.near", 1);
        v.set_paused(true);
        ctx("agent.near", 1);
        v.swap("usdc.near".parse().unwrap(), U128(1), DEP.parse().unwrap());
    }
}
