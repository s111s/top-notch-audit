#!/usr/bin/env bash
# Builds the contract and lowers it to WASM MVP features (what nearcore accepts).
set -euo pipefail
cd "$(dirname "$0")"
RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release
W=target/wasm32-unknown-unknown/release/top_notch_vault.wasm
F="--enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals --enable-reference-types --enable-multivalue"
npx wasm-opt "$W" $F --llvm-memory-copy-fill-lowering --signext-lowering --llvm-nontrapping-fptoint-lowering -Oz -o /tmp/tn_vault_low.wasm
npx wasm-opt /tmp/tn_vault_low.wasm --mvp-features --enable-mutable-globals -o top_notch_vault.wasm
ls -la top_notch_vault.wasm
